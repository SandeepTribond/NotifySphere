import messaging from '@react-native-firebase/messaging';
import DeviceInfo from 'react-native-device-info';
import RNInstallReferrer from 'react-native-install-referrer';
import notifee, {
  AndroidImportance,
  AndroidVisibility,
  AndroidStyle,
  EventType,
  type AndroidChannel,
} from '@notifee/react-native';
import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { PermissionsAndroid, Platform } from 'react-native';

const STORAGE_KEY_TOKEN    = '@notifysphere_fcm_token';
const STORAGE_KEY_SUB_ID   = '@notifysphere_subscription_id';
const STORAGE_KEY_USER_HASH = '@notifysphere_user_hash';
const STORAGE_KEY_CHANNELS  = '@notifysphere_channels';
const STORAGE_KEY_CHANNEL_MIGRATED = '@notifysphere_channel_default_migrated_v1';

// ─── Type definitions ──────────────────────────────────────────────────────────

/** Shape of a Firebase Cloud Messaging remote message */
export interface FirebaseRemoteMessage {
  messageId?: string;
  notification?: {
    title?: string;
    body?: string;
    android?: { imageUrl?: string };
    ios?: {
      attachments?: Array<{ url?: string }>;
      /** Sound name or critical-sound config — populated by RNFB on iOS */
      sound?: string | { name?: string; critical?: boolean; volume?: number };
    };
    imageUrl?: string;
  };
  data?: Record<string, string>;
}

/** Shape of a Notifee notification object (returned from press events) */
export interface NotifeeNotification {
  id?: string;
  title?: string;
  body?: string;
  data?: Record<string, string>;
  android?: { largeIcon?: string };
  ios?: { attachments?: Array<{ url?: string }> };
}

/** Normalised notification data delivered to the consumer callback */
export type NotificationData = {
  title?: string;
  body?: string;
  data?: Record<string, string>;
  image?: string;
  sound?: string;
};

export type NotificationCallback = (
  notification: NotificationData,
  type?: string
) => void;

/** Shape of a single notification channel returned by the registration API */
export interface BackendChannelConfig {
  channel_id: string;
  name: string;
  description?: string;
  /** Android importance level sent by backend — mapped to AndroidImportance */
  Importance?: number;
  /** 1 = enable LED, 0 = disable */
  LED?: number;
  led_color?: string | null;
  /** 'Custom' | 'Default' | 'None' */
  sound?: string;
  /** Raw resource name used when sound === 'Custom' (e.g. 'nowait_sound') */
  soundDetail?: string;
  /** 1 = vibration on, 0 = off */
  vibration?: number;
  vibrationDetail?: string | null;
  badge?: number;
  /** 1 = PUBLIC, 0 = PRIVATE, -1 = SECRET */
  lockScreen?: number;
}

export type InitializeConfig = {
  /** Your application's user ID for this device */
  applicationUserId: number;
  /** Push type, e.g. 'AndroidPush' or 'IOSPush' */
  type: string;
  /** NotifySphere app ID (required) */
  appId: string;
  name?: string;
  lat?: string;
  long?: string;
  city?: string;
  state?: string;
  email?: string;
  /** Phone number as a string to preserve leading zeros and country codes */
  phone?: string;
  tags?: Record<string, string>;
  /**
   * Base URL of your NotifySphere API server.
   * Defaults to the hosted service.
   */
  baseUrl?: string;
  /**
   * Full URL of your onpress-tracking endpoint.
   * Defaults to the hosted service.
   */
  trackingUrl?: string;
  /**
   * Full URL of your delivery-confirmation endpoint.
   * Called as soon as a notification is received (foreground, background, or
   * terminated — see note below).
   * Defaults to the hosted service.
   *
   * NOTE: delivery confirmation when the app is terminated only works for
   * **data-only** FCM messages (no `notification` field in the payload).
   * If the payload contains a `notification` field, the OS delivers it
   * silently without waking the app, so this callback cannot fire.
   */
  deliveryUrl?: string;
  /**
   * Optional API key sent as a Bearer token to the tracking endpoints.
   * Never hard-code this — read it from a secure config or environment.
   */
  apiKey?: string;
  /** Enable verbose logging. Defaults to false. */
  debug?: boolean;
};

// ─── Internal logger ──────────────────────────────────────────────────────────

let _debug = false;

const log = (...args: unknown[]) => {
  if (_debug) console.log('[NotifySphere]', ...args);
};
const warn = (...args: unknown[]) => {
  if (_debug) console.warn('[NotifySphere]', ...args);
};
// Errors are always surfaced regardless of the debug flag
const logError = (...args: unknown[]) =>
  console.error('[NotifySphere]', ...args);

// ─── SDK version ──────────────────────────────────────────────────────────────

const SDK_VERSION = '1.2.6';

// ─── Device info result shape ─────────────────────────────────────────────────

interface DeviceInfoResult {
  sdk: string;
  device_model: string;
  device_os: string;
  device_version: string;
  carrier: string;
  app_version: string;
  timezone_id: string;
}

// ─── Default endpoints ────────────────────────────────────────────────────────

// Production NotifySphere API. Do NOT switch this to a staging URL before
// running `yarn prepare` / `npm publish` — the value is compiled into `lib/`
// and ships to every consumer.
// Production NotifySphere API. Do NOT switch this to a staging URL before
// running `yarn prepare` / `npm publish` — the value is compiled into `lib/`
// and ships to every consumer.
const DEFAULT_BASE_URL = 'https://api.notifysphere.in/client/';
// const DEFAULT_BASE_URL = 'https://apinotify.dothejob.in/client';

// ─── NotifySphere class ───────────────────────────────────────────────────────

class NotifySphere {
  private static callback: NotificationCallback | null = null;
  private static fcmToken: string | null = null;
  private static appId: string | null = null;
  private static subscriptionId: string | null = null;
  private static baseUrl: string = DEFAULT_BASE_URL;
  private static trackingUrl: string = '';
  private static deliveryUrl: string = '';
  private static apiKey: string | null = null;
  private static unsubscribers: Array<() => void> = [];
  private static initialized = false;
  private static createdChannels = new Set<string>();

  // ─── Press tracking ──────────────────────────────────────────────────────

  /**
   * Tracks a notification press event and fires the consumer callback.
   * Accepts both Firebase remote messages and Notifee notification objects.
   */
  static async callbackOnpress(
    notification: FirebaseRemoteMessage | NotifeeNotification,
    status: string
  ): Promise<void> {
    try {
      const notificationId =
        (notification as FirebaseRemoteMessage).data?.notification_id ??
        (notification as NotifeeNotification).data?.notification_id;

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (NotifySphere.apiKey) {
        headers['Authorization'] = `Bearer ${NotifySphere.apiKey}`;
      }

      const response = await axios.post(
        NotifySphere.trackingUrl,
        {
          notification_id: notificationId,
          subscription_id: NotifySphere.subscriptionId,
          onPressStatus: 1,
        },
        { headers, maxBodyLength: 1024 * 50, timeout: 10000 }
      );

      log('onPress tracking response:', response.data);
      NotifySphere.sendCallback(notification, status);
    } catch (err) {
      logError('Error in callbackOnpress:', err);
    }
  }

  // ─── Delivery confirmation ───────────────────────────────────────────────

  /**
   * Sends a delivery receipt to the server as soon as a notification arrives.
   *
   * This fires in three scenarios:
   *  - Foreground  : app is open when the message arrives
   *  - Background  : app is alive in the background (data-only FCM message)
   *  - Terminated  : app is completely killed (data-only FCM message only —
   *                  notification messages are shown by the OS without waking
   *                  the app, so this cannot fire in that case)
   */
  private static async callbackOnDelivery(
    remoteMessage: FirebaseRemoteMessage
  ): Promise<void> {
    try {
      const notificationId = remoteMessage.data?.notification_id;

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (NotifySphere.apiKey) {
        headers['Authorization'] = `Bearer ${NotifySphere.apiKey}`;
      }
      log('Sending delivery confirmation to:', NotifySphere.deliveryUrl);
      const response = await axios.post(
        NotifySphere.deliveryUrl,
        {
          notification_id: notificationId,
          subscription_id: NotifySphere.subscriptionId,
          onDeliveredStatus: 1,
        },
        { headers, maxBodyLength: 1024 * 50, timeout: 10000 }
      );

      log('Delivery confirmation response:', response.data);
    } catch (err) {
      logError('Error sending delivery confirmation:', err);
    }
  }

  // ─── Permissions ─────────────────────────────────────────────────────────

  static async checkApplicationPermission(): Promise<boolean> {
      log('🔥 checkApplicationPermission START');
    try {
          log('🔥 Platform:', Platform.OS);
    log('🔥 Platform Version:', Platform.Version);
     
    if (Platform.OS === 'android' && Platform.Version >= 33) {
          // const granted = await PermissionsAndroid.request(
        //   PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS
        // );
     const alreadyGranted = await PermissionsAndroid.check(
        PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS
      );
       log('🔐 Notification permission already granted:', alreadyGranted);

  if (alreadyGranted) {
        return true;
      }

         log('🔥 BEFORE PermissionsAndroid.request');

            const requestPromise = PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS
      );


        const timeoutPromise = new Promise<string>((resolve) => {
        setTimeout(() => {
          log('⏰ Permission request timeout');
          resolve(PermissionsAndroid.RESULTS.DENIED);
        }, 10000);
      });

      const granted = await Promise.race([
        requestPromise,
        timeoutPromise,
      ]);



         log('🔥 AFTER PermissionsAndroid.request:', granted);
        return granted === PermissionsAndroid.RESULTS.GRANTED;
      } else if (Platform.OS === 'ios') {
        const authStatus = await messaging().requestPermission();
        return (
          authStatus === messaging.AuthorizationStatus.AUTHORIZED ||
          authStatus === messaging.AuthorizationStatus.PROVISIONAL
        );
      }

        log('🔥 Permission request skipped');
      return true;
    } catch (err) {
       logError('🔥 Permission ERROR:', err);
      logError('Error requesting notification permission:', err);
      return false;
    }
  }

  // ─── Device info ──────────────────────────────────────────────────────────

  /**
   * Collects device metadata sent to the registration API.
   * Uses react-native-device-info for model, carrier, and app version.
   * Falls back gracefully if any call fails so registration is never blocked.
   */
  private static async getDeviceInfo(): Promise<DeviceInfoResult> {
    try {
      // getCarrier() is the only async call — run everything in parallel
      const [carrier] = await Promise.all([
        DeviceInfo.getCarrier().catch(() => ''),
      ]);

      return {
        sdk:            SDK_VERSION,
        device_model:   DeviceInfo.getModel(),
        device_os:      Platform.OS,
        device_version: DeviceInfo.getSystemVersion(),
        carrier:        carrier ?? '',
        app_version:    DeviceInfo.getVersion(),
        // Intl is available in Hermes/JSC without any extra package
        timezone_id:    Intl.DateTimeFormat().resolvedOptions().timeZone ?? '',
      };
    } catch (err) {
      warn('getDeviceInfo failed, using fallback values:', err);
      return {
        sdk:            SDK_VERSION,
        device_model:   '',
        device_os:      Platform.OS,
        device_version: String(Platform.Version),
        carrier:        '',
        app_version:    '',
        timezone_id:    '',
      };
    }
  }

  // ─── User details fingerprint ─────────────────────────────────────────────

  /**
   * Builds a stable string fingerprint of all user-profile fields.
   * Used to detect whether any detail has changed since the last registration,
   * so the API is only called when something actually differs.
   */
  private static buildUserHash(config: InitializeConfig): string {
    const fields = {
      applicationUserId: config.applicationUserId,
      type: config.type,
      name: config.name ?? '',
      lat: config.lat ?? '',
      long: config.long ?? '',
      city: config.city ?? '',
      state: config.state ?? '',
      email: config.email ?? '',
      phone: config.phone ?? '',
      // Stringify tags with sorted keys so order doesn't affect the hash
      tags: config.tags
        ? JSON.stringify(
            Object.keys(config.tags)
              .sort()
              .reduce<Record<string, string>>((acc, k) => {
                acc[k] = config.tags![k]!;
                return acc;
              }, {})
          )
        : '',
    };
    return JSON.stringify(fields);
  }

  // ─── iOS APNs registration ────────────────────────────────────────────────

  /**
   * On iOS, Firebase cannot issue an FCM token until the device is registered
   * with APNs. `messaging().registerDeviceForRemoteMessages()` is the official
   * react-native-firebase API that calls `registerForRemoteNotifications()`
   * natively and resolves only when the APNs token has been delivered — no
   * polling needed. Safe to call multiple times (idempotent).
   */
  private static async registerForRemoteMessagesIfNeeded(): Promise<void> {
    try {
      await messaging().registerDeviceForRemoteMessages();
      log('iOS: device registered for remote messages (APNs token ready)');
    } catch (err) {
      warn('iOS: registerDeviceForRemoteMessages failed:', err);
    }
  }

  // ─── Initialize ──────────────────────────────────────────────────────────

  /**
   * Initialises the SDK and sets up notification listeners.
   *
   * Safe to call every time the app opens — it only hits the registration API
   * when the FCM token OR any user detail (email, phone, location, tags, etc.)
   * has changed since the last successful registration.
   * Listeners are registered only once per process lifetime.
   *
   * Token changes are also handled automatically via `onTokenRefresh`.
   */
  static async initialize(
    config: InitializeConfig
  ): Promise<string | undefined> {
 
_debug = config.debug ?? false;
    NotifySphere.appId = config.appId;
    NotifySphere.baseUrl = NotifySphere.enforceHttps(config.baseUrl ?? DEFAULT_BASE_URL, true);
    NotifySphere.trackingUrl = NotifySphere.enforceHttps(
      config.trackingUrl ?? `${NotifySphere.baseUrl}${config.appId}/onpress/handle`
    );
    NotifySphere.deliveryUrl = NotifySphere.enforceHttps(
      config.deliveryUrl ?? `${NotifySphere.baseUrl}${config.appId}/delivery/confirm`
    );
    NotifySphere.apiKey = config.apiKey ?? null;

log('initialize1')
    try {
log('initialize2')
    await NotifySphere.checkApplicationPermission();
      // On iOS, ensure the device is registered with APNs before asking
      // Firebase for an FCM token. Without this, getToken() throws
      // "No APNS token specified" on the first launch.
      if (Platform.OS === 'ios') {
        await NotifySphere.registerForRemoteMessagesIfNeeded();
      }

      log('initialize3')
            
      const fcmToken = await messaging().getToken();
      NotifySphere.fcmToken = fcmToken ?? '';

        log('initialize4')
      // ── Restore cached subscription_id immediately so tracking calls
      //    have it available even before the registration API responds.
      const cachedSubId = await AsyncStorage.getItem(STORAGE_KEY_SUB_ID);
      if (cachedSubId) {
        NotifySphere.subscriptionId = cachedSubId;
      }

     

      // ── Only call the registration API when the FCM token OR any user
      //    detail has changed. This avoids a redundant network call on every
      //    app open while still syncing updates (email, phone, location, etc.)
      const [cachedToken, cachedUserHash, cachedChannels] = await Promise.all([
        AsyncStorage.getItem(STORAGE_KEY_TOKEN),
        AsyncStorage.getItem(STORAGE_KEY_USER_HASH),
        AsyncStorage.getItem(STORAGE_KEY_CHANNELS),
      ]);

     
      // Re-create all backend-configured channels on every launch so they
      // always exist before a background notification arrives — even after
      // a reinstall or app-data clear. Notifee's createChannel is idempotent.
      // Channels are Android-only; skip on iOS.
      if (Platform.OS === 'android' && cachedChannels) {
        const channels = JSON.parse(cachedChannels) as BackendChannelConfig[];
        await NotifySphere.createChannelsFromConfig(channels);
      }
      const currentUserHash = NotifySphere.buildUserHash(config);
      let subscriptionId: string | undefined = cachedSubId ?? undefined;

      const tokenChanged = fcmToken !== cachedToken;
      const userChanged = currentUserHash !== cachedUserHash;


      // ── Extract install referrer attribution (Android only)
      if (Platform.OS === 'android') {
        try {
          const referrerResult = await RNInstallReferrer.getReferrer();
          const referrerString: string | null = referrerResult?.installReferrer ?? null;
        log('referrerResultnpm',referrerResult)
        
          if (referrerString) {
            const params = new URLSearchParams(referrerString);
            const nsClick = params.get('ns_click');
            const cid = params.get('cid');
            config = {
              ...config,
              tags: {
                ...(config.tags ?? {}),
                ...(nsClick ? { ns_click: nsClick } : {}),
                ...(cid ? { cid } : {}),
              },
            };
          }
        } catch (e) {
          log('Install referrer unavailable:', e);
        }
      }

      if (tokenChanged || userChanged) {
        if (tokenChanged) log('FCM token changed — re-registering device');
        if (userChanged) log('User details changed — re-registering device');
        subscriptionId = await NotifySphere.registerDevice(
          config,
          fcmToken,
          currentUserHash
        );
      } else {
        log('Token and user details unchanged — skipping registration API call');
      }


 
          NotifySphere.postEvent({
     event: 'initialize_start',
    appId: config.appId,
    data: {
      config,
      subscriptionId: 'aea4d918e07921f1e2bce8bc606fa5ba6bd1ea7b7f7c6304',
    },
  });

      // ── Android: ensure the default channel exists (idempotent)
      if (Platform.OS === 'android') {
        // One-time migration: pre-v1.2.5 builds created `channel_default`
        // without an explicit `sound` field, which on some devices left the
        // channel permanently silent (channels are immutable on Android). The
        // first time we run on v1.2.5+, delete that legacy channel so the
        // corrected definition (sound: 'default') can take effect. This is
        // safe to do in `initialize()` because the app is in the foreground
        // here — there are no active background notifications to accidentally
        // cancel (unlike in `setBackgroundHandler`).
        try {
          const migrated = await AsyncStorage.getItem(
            STORAGE_KEY_CHANNEL_MIGRATED
          );
          if (!migrated) {
            await notifee.deleteChannel('channel_default').catch(() => {
              /* didn't exist — fine */
            });
            await AsyncStorage.setItem(STORAGE_KEY_CHANNEL_MIGRATED, '1');
            log('channel_default migrated (deleted) — will be recreated below');
          }
        } catch (err) {
          warn('channel_default migration failed:', err);
        }

        await NotifySphere.ensureChannel(
          'channel_default',
          'Default Channel',
          'default'
        );
      }

      if (!NotifySphere.initialized) {
         log('🚀 setupListeners calling...');
        NotifySphere.setupListeners();
        // Watch for token refreshes (Firebase can rotate the token silently)
        NotifySphere.watchTokenRefresh(config);
        NotifySphere.initialized = true;
         log('✅ setupListeners done');
      }

      return subscriptionId;
    } catch (err:any) {
      // logError('Notifysphre initialization error:', err);
 logError('Notifysphre initialization error:',err);
      NotifySphere.postEvent({
          event: 'initialize_error',
          appId: config.appId,
          data: {
            config,
            subscriptionId: 'aea4d918e07921f1e2bce8bc606fa5ba6bd1ea7b7f7c6304',
            error:JSON.stringify(err)
          },
        });

       throw new Error(
    `NotifySphere initialization failed: ${err instanceof Error ? err.message : String(err)}`
  );
    }
  }

  /**
   * Calls the registration API and persists the token, subscription_id, and
   * user hash so future launches can detect what has changed.
   * Extracted so it can also be called from the token-refresh watcher.
   */
  private static async registerDevice(
    config: InitializeConfig,
    fcmToken: string,
    userHash?: string
  ): Promise<string | undefined> {

    const devInfo = await NotifySphere.getDeviceInfo();
    const res = await axios.post(
      `${NotifySphere.baseUrl}${config.appId}/users`,
      {
        applicationUserId: config.applicationUserId,
        token: fcmToken,
        type: config.type,
        user: {
          userName: config.name,
          lat: config.lat,
          long: config.long,
          city: config.city,
          state: config.state,
          email: config.email,
          phone: config.phone,
          tags: config.tags,
          sdk: devInfo.sdk,
          device_model: devInfo.device_model,
          device_os: devInfo.device_os,
          device_version: devInfo.device_version,
          carrier: devInfo.carrier,
          app_version: devInfo.app_version,
          timezone_id: devInfo.timezone_id,
        },
      },
      {
        headers: {
          'Content-Type': 'application/json',
          ...(NotifySphere.apiKey
            ? { Authorization: `Bearer ${NotifySphere.apiKey}` }
            : {}),
        },
        maxBodyLength: 1024 * 50,
        timeout: 10000,
      }
    );

    log('Device registration response:', res.data);
    const subscriptionId: string | undefined = res.data?.subscription_id;
    NotifySphere.subscriptionId = subscriptionId ?? null;

    // Extract channels from the response and create them immediately.
    // Channels are Android-only — skip on iOS to avoid Notifee warnings.
    const channels: BackendChannelConfig[] | undefined =
      res.data?.notification_channels;
    if (Platform.OS === 'android' && channels && channels.length > 0) {
      await NotifySphere.createChannelsFromConfig(channels);
      await AsyncStorage.setItem(STORAGE_KEY_CHANNELS, JSON.stringify(channels));
      log('Channels created and cached from registration response:', channels.length);
    }

    // Persist token, subscription_id, and user hash for future launch comparisons
    const hash = userHash ?? NotifySphere.buildUserHash(config);
    await Promise.all([
      AsyncStorage.setItem(STORAGE_KEY_TOKEN, fcmToken),
      AsyncStorage.setItem(STORAGE_KEY_USER_HASH, hash),
      subscriptionId
        ? AsyncStorage.setItem(STORAGE_KEY_SUB_ID, subscriptionId)
        : Promise.resolve(),
    ]);

    return subscriptionId;
  }

  /**
   * Listens for Firebase token refreshes and automatically re-registers
   * the device when the token rotates, without requiring the consumer to
   * call initialize() again.
   */
  private static watchTokenRefresh(config: InitializeConfig): void {
    const unsubRefresh = messaging().onTokenRefresh(async (newToken) => {
      log('FCM token refreshed — re-registering device');
      NotifySphere.fcmToken = newToken;
      try {
        // User details haven't changed here, reuse the existing hash
        const existingHash =
          (await AsyncStorage.getItem(STORAGE_KEY_USER_HASH)) ??
          NotifySphere.buildUserHash(config);
        await NotifySphere.registerDevice(config, newToken, existingHash);
      } catch (err) {
        logError('Error re-registering after token refresh:', err);
      }
    });
    NotifySphere.unsubscribers.push(unsubRefresh);
  }

  // ─── Post campaign event ──────────────────────────────────────────────────

  /**
   * Posts a campaign event to the NotifySphere platform.
   *
   * Use this to track custom conversion events (e.g. 'booking', 'purchase',
   * 'signup') from within your app so they can be attributed to a campaign.
   *
   * The `subscription_id` is read automatically from the value persisted by
   * `initialize()`. If `ns_click` is not provided the field is omitted from
   * the request body.
   *
   * @example
   * await NotifySphere.postEvent({ event: 'booking', nsClick: 'abc123' });
   */
  static async postEvent(params: {
    /** The event name, e.g. 'booking', 'purchase', 'signup' */
    event: string;
    /**
     * The `ns_click` attribution token received from a campaign deep-link.
     * Optional — omit if not available.
     */
    nsClick?: string;
    /** Falls back to the appId provided in initialize() */
    appId?: string;
    data?:any
  }): Promise<unknown> {
    log('NotifysphareEventParams0',params)
    const appId = params.appId ?? NotifySphere.appId;

   

    if (!appId) {
      warn('appId missing — cannot post event');
      return null;
    }
     log('NotifysphareEventParams1',params,NotifySphere.subscriptionId)
    // if (!NotifySphere.subscriptionId) {
    //      console.log('subscriptionId not found',NotifySphere.subscriptionId)
   
    //   warn('subscription_id missing — cannot post event (call initialize() first)');
    //   return null;
    // }

      log('NotifysphareEventParams2',params,NotifySphere.subscriptionId)
   

    try {
      const body: Record<string, any>  = {
        event: params.event,
        subscription_id: NotifySphere.subscriptionId,
       
      };

      if (params.nsClick) {
        body['ns_click'] = params.nsClick;
      }

      if (params.data !== undefined && params.data !== null) {
        body.data = params.data;
      }

   log('NotifysphareEventParams3',JSON.stringify(body))
   
      const res = await axios.post(
        `${NotifySphere.baseUrl}${appId}/campaign/event`,
        body,
        {
          headers: {
            'Content-Type': 'application/json',
            ...(NotifySphere.apiKey
              ? { Authorization: `Bearer ${NotifySphere.apiKey}` }
              : {}),
          },
          maxBodyLength: 1024 * 50,
          timeout: 10000,
        }
      );
      log('NotifysphareEventParams4',res.data)

      log('postEvent response:', res.data);
      return res.data;
    } catch (err) {
      logError('Error posting campaign event:', err);
      return null;
    }
  }

  // ─── Update tags ─────────────────────────────────────────────────────────

  /**
   * Updates user tags without re-registering the device.
   * `appId` is optional here — it falls back to the value passed in `initialize`.
   */
  static async updateTags(params: {
    applicationUserId: number;
    type: string;
    tags: Record<string, string>;
    /** Falls back to the appId provided in initialize() */
    appId?: string;
  }): Promise<unknown> {
    const appId = params.appId ?? NotifySphere.appId;

    if (!NotifySphere.fcmToken) {
      warn('FCM token missing — cannot update tags');
      return null;
    }
    if (!appId) {
      warn('appId missing — cannot update tags');
      return null;
    }

    try {
      const res = await axios.post(
        `${NotifySphere.baseUrl}${appId}/users`,
        {
          applicationUserId: params.applicationUserId,
          token: NotifySphere.fcmToken,
          type: params.type,
          user: { tags: params.tags },
        },
        {
          headers: {
            'Content-Type': 'application/json',
            ...(NotifySphere.apiKey
              ? { Authorization: `Bearer ${NotifySphere.apiKey}` }
              : {}),
          },
          maxBodyLength: 1024 * 50,
          timeout: 10000,
        }
      );

      log('Tags update response:', res.data);
      return res.data;
    } catch (err) {
      logError('Error updating tags:', err);
      return null;
    }
  }

  // ─── Public callback setter ───────────────────────────────────────────────

  /** Register a callback to receive notification events (received / opened / initial). */
  static onNotification(callback: NotificationCallback): void {
    NotifySphere.callback = callback;
  }

  // ─── Background handler ───────────────────────────────────────────────────

  /**
   * Registers Firebase and Notifee background handlers.
   *
   * **IMPORTANT:** Call this in your root `index.js` file, before
   * `AppRegistry.registerComponent()`, so it is available when the app wakes
   * in the background — or starts from a terminated state — to handle a
   * notification.
   *
   * When the app is **terminated**, React Native only runs `index.js` (a
   * headless JS task). Your app components and `initialize()` never execute,
   * so any custom `deliveryUrl` / `apiKey` you passed to `initialize()` are
   * not available. Pass them here instead so they are set before the handler
   * fires.
   *
   * @example
   * // index.js
   * import { AppRegistry } from 'react-native';
   * import NotifySphere from 'react-native-notify-sphere';
   * import App from './App';
   *
   * NotifySphere.setBackgroundHandler({
   *   deliveryUrl: 'https://your-server.com/ondelivery/handle', // optional
   *   apiKey: 'your-api-key',                                   // optional
   * });
   * AppRegistry.registerComponent('MyApp', () => App);
   */
  // static setBackgroundHandler(config?: {
  //   /**
  //    * Override the delivery-confirmation URL for background/terminated state.
  //    * Required if you use a custom deliveryUrl AND need it to work when the
  //    * app is terminated (since initialize() won't have run yet).
  //    */
  //   deliveryUrl?: string;
  //   /**
  //    * Override the API key for background/terminated state.
  //    * Required if you use apiKey AND need delivery receipts when terminated.
  //    */
  //   apiKey?: string;
  //   /**
  //    * The subscription ID returned by initialize().
  //    * If omitted, the SDK will read it from AsyncStorage inside the handler
  //    * so the registration itself can stay synchronous (required by FCM).
  //    */
  //   subscriptionId?: string;
  //   /**
  //    * Your NotifySphere appId. Used to derive the default `deliveryUrl`
  //    * (`${baseUrl}${appId}/delivery/confirm`) when the app is started from a
  //    * terminated state and `initialize()` has not yet run.
  //    */
  //   appId?: string;
  //   /**
  //    * Override the base URL for the NotifySphere API. Defaults to the hosted
  //    * service. Used together with `appId` to derive `deliveryUrl`.
  //    */
  //   baseUrl?: string;
  //   /** Enable verbose logging. Defaults to false. */
  //   debug?: boolean;
  // }): void {
  //   // ────────────────────────────────────────────────────────────────────────
  //   // IMPORTANT: this function MUST be called synchronously at the top of
  //   // index.js (before AppRegistry.registerComponent). Firebase requires the
  //   // background message handler to be registered at module-evaluation time,
  //   // otherwise messages delivered in killed/background state will be dropped
  //   // because no handler is registered yet when the headless JS task starts.
  //   //
  //   // Anything that needs AsyncStorage (subscription_id) MUST be loaded
  //   // *inside* the async handler below — not before this call.
  //   // ────────────────────────────────────────────────────────────────────────

  //   if (config?.debug) _debug = true;

  //   // Apply any config overrides immediately so they are in place even when
  //   // the app starts from a terminated state.
  //   if (config?.deliveryUrl) {
  //     NotifySphere.deliveryUrl = NotifySphere.enforceHttps(config.deliveryUrl);
  //   } else if (config?.appId) {
  //     // Derive the default delivery URL from appId + baseUrl so the SDK can
  //     // post delivery receipts even when initialize() has not yet run
  //     // (terminated-state launches).
  //     const base = NotifySphere.enforceHttps(
  //       config.baseUrl ?? DEFAULT_BASE_URL,
  //       true
  //     );
  //     NotifySphere.baseUrl = base;
  //     NotifySphere.deliveryUrl = NotifySphere.enforceHttps(
  //       `${base}${config.appId}/delivery/confirm`
  //     );
  //     NotifySphere.appId = config.appId;
  //   }
  //   if (config?.apiKey) {
  //     NotifySphere.apiKey = config.apiKey;
  //   }
  //   if (config?.subscriptionId) {
  //     NotifySphere.subscriptionId = config.subscriptionId;
  //   }

  //   // Pre-create the default Android channel immediately so it is guaranteed to
  //   // exist before any background or terminated-state message arrives.
  //   // Skipped on iOS — channels are an Android-only concept.
  //   //
  //   // IMPORTANT: explicitly set `sound: 'default'` so Notifee binds the
  //   // channel to RingtoneManager.TYPE_NOTIFICATION. Android NotificationChannels
  //   // are immutable after creation — if anything (e.g. the FCM library on a
  //   // previous app version) created `channel_default` silently first, every
  //   // subsequent push to this channel will be silent forever for that user.
  //   //
  //   // ⚠️ DO NOT call `notifee.deleteChannel` here.
  //   //
  //   // In terminated state Android dispatches the FCM message and starts the
  //   // headless JS task in parallel. If the payload has a `notification` field,
  //   // FCM has ALREADY posted the notification to `channel_default` by the time
  //   // our JS runs — and deleting the channel cancels every active notification
  //   // attached to it. The user sees the notification "pop in and immediately
  //   // disappear" because our migration killed it. Channel cleanup must happen
  //   // somewhere safe (in `initialize()` behind an AsyncStorage flag), never in
  //   // the background-handler module init path.
  //   if (Platform.OS === 'android') {
  //     notifee.createChannel({
  //       id: 'channel_default',
  //       name: 'Default Channel',
  //       importance: AndroidImportance.HIGH,
  //       sound: 'default',
  //       lights: true,
  //       lightColor: '#0000FF',
  //       vibration: true,
  //       visibility: AndroidVisibility.PUBLIC,
  //     });
  //   }

  //   messaging().setBackgroundMessageHandler(async (remoteMessage) => {
  //     const msg = remoteMessage as FirebaseRemoteMessage;

  //     // Diagnostic — always-on so users can confirm the handler is firing
  //     // even without enabling debug mode. Remove or convert to log() once
  //     // background delivery is verified in production.
  //     console.log(
  //       '[NotifySphere] background handler fired.Testing',
  //       'hasNotificationField=', msg.notification != null,
  //       'notification=', JSON.stringify(msg.notification ?? null),
  //       'data=', JSON.stringify(msg.data ?? {})
  //     );

  //     // Lazy-load subscription_id from AsyncStorage if it wasn't injected via
  //     // setBackgroundHandler({ subscriptionId }). Async work is safe HERE
  //     // because the handler itself is already registered.
  //     if (!NotifySphere.subscriptionId) {
  //       try {
  //         const cachedSubId = await AsyncStorage.getItem(STORAGE_KEY_SUB_ID);
  //         if (cachedSubId) NotifySphere.subscriptionId = cachedSubId;
  //       } catch (err) {
  //         warn('Failed to read cached subscription_id in background:', err);
  //       }
  //     }

  //     // ────────────────────────────────────────────────────────────────────
  //     // Background / terminated state — display is the OS's job, NOT ours.
  //     //
  //     // For the overwhelming majority of consumers the FCM payload includes
  //     // a top-level `notification` field, which means:
  //     //   - Android: FCM library auto-displays the notification using
  //     //              `channel_default` (the channel id we pre-create above).
  //     //   - iOS    : APNs auto-displays.
  //     // Both platforms handle sound, channel, importance, large/small icon,
  //     // lock-screen visibility, etc. correctly without any JS work.
  //     //
  //     // Earlier versions of this SDK ALSO called `displayLocalNotification`
  //     // from this handler so that data-only payloads would render via
  //     // Notifee. The problem: when the backend sent a mixed payload (the
  //     // common case), the OS displayed once and the SDK displayed again →
  //     // two notifications, the second one frequently blank (the OS-side
  //     // title/body lived in the `notification` block while the SDK looked
  //     // them up in `data`). We've removed that call entirely.
  //     //
  //     // The handler is now single-purpose in background: fire the delivery
  //     // confirmation API. Display is delegated to FCM/APNs.
  //     //
  //     // If a consumer truly needs data-only-payload support (no OS auto-
  //     // display, JS draws the notification), they should:
  //     //   - register a Notifee `onBackgroundEvent` of their own that calls
  //     //     `notifee.displayNotification`, or
  //     //   - add a `displayInBackground: true` opt-in to setBackgroundHandler
  //     //     in a future release.
  //     // ────────────────────────────────────────────────────────────────────
  //     await NotifySphere.callbackOnDelivery(msg);
  //   });

  //   notifee.onBackgroundEvent(async ({ type, detail }) => {
  //     log('Background notifee event, type:', type);
  //     if (type === EventType.PRESS && detail.notification) {
  //       await NotifySphere.callbackOnpress(
  //         detail.notification as NotifeeNotification,
  //         'press'
  //       );
  //     }
  //   });
  // }

  // ─── Cleanup ──────────────────────────────────────────────────────────────



  static setBackgroundHandler(config?: {
  /**
   * Override the delivery-confirmation URL for background/terminated state.
   * Required if you use a custom deliveryUrl AND need it to work when the
   * app is terminated (since initialize() won't have run yet).
   */
  deliveryUrl?: string;
  /**
   * Override the API key for background/terminated state.
   * Required if you use apiKey AND need delivery receipts when terminated.
   */
  apiKey?: string;
  /**
   * The subscription ID returned by initialize().
   * If omitted, the SDK will read it from AsyncStorage inside the handler
   * so the registration itself can stay synchronous (required by FCM).
   */
  subscriptionId?: string;
  /**
   * Your NotifySphere appId. Used to derive the default `deliveryUrl`
   * (`${baseUrl}${appId}/delivery/confirm`) when the app is started from a
   * terminated state and `initialize()` has not yet run.
   */
  appId?: string;
  /**
   * Override the base URL for the NotifySphere API. Defaults to the hosted
   * service. Used together with `appId` to derive `deliveryUrl`.
   */
  baseUrl?: string;
  /** Enable verbose logging. Defaults to false. */
  debug?: boolean;
}): void {
  // IMPORTANT: this function MUST be called synchronously at the top of
  // index.js (before AppRegistry.registerComponent). Firebase requires the
  // background message handler to be registered at module-evaluation time.
  // Anything that needs AsyncStorage MUST be loaded *inside* the async
  // handler below, not before this call.

  // ── 1. Config overrides ────────────────────────────────────────────────
  try {
    if (config?.debug) _debug = true;

    if (config?.deliveryUrl) {
      NotifySphere.deliveryUrl = NotifySphere.enforceHttps(config.deliveryUrl);
    } else if (config?.appId) {
      const base = NotifySphere.enforceHttps(
        config.baseUrl ?? DEFAULT_BASE_URL,
        true,
      );
      NotifySphere.baseUrl = base;
      NotifySphere.deliveryUrl = NotifySphere.enforceHttps(
        `${base}${config.appId}/delivery/confirm`,
      );
      NotifySphere.appId = config.appId;
    }
    if (config?.apiKey) {
      NotifySphere.apiKey = config.apiKey;
    }
    if (config?.subscriptionId) {
      NotifySphere.subscriptionId = config.subscriptionId;
    }
  } catch (err) {
    logError('setBackgroundHandler: failed to apply config overrides:', err);
  }

  // ── 2. Default Android channel ─────────────────────────────────────────
  // DO NOT call notifee.deleteChannel here (it cancels active notifications
  // in terminated state). Channel cleanup belongs in initialize().
  try {
    if (Platform.OS === 'android') {
      notifee
        .createChannel({
          id: 'channel_default',
          name: 'Default Channel',
          importance: AndroidImportance.HIGH,
          sound: 'default',
          lights: true,
          lightColor: '#0000FF',
          vibration: true,
          visibility: AndroidVisibility.PUBLIC,
        })
        .catch((err: any) => {
          logError('setBackgroundHandler: createChannel rejected:', err);
        });
    }
  } catch (err) {
    logError('setBackgroundHandler: createChannel threw:', err);
  }

  // ── 3. FCM background message handler ──────────────────────────────────
  try {
    messaging().setBackgroundMessageHandler(async (remoteMessage) => {
      try {
        const msg = remoteMessage as FirebaseRemoteMessage;

        try {
          log(
            '[NotifySphere] background handler fired.Testing',
            'hasNotificationField=',
            msg?.notification != null,
            'notification=',
            JSON.stringify(msg?.notification ?? null),
            'data=',
            JSON.stringify(msg?.data ?? {}),
          );
        } catch (logErr) {
          // JSON.stringify can throw on circular data; never let logging crash us
        }

        // Lazy-load subscription_id from AsyncStorage if not injected.
        if (!NotifySphere.subscriptionId) {
          try {
            const cachedSubId = await AsyncStorage.getItem(STORAGE_KEY_SUB_ID);
            if (cachedSubId) NotifySphere.subscriptionId = cachedSubId;
          } catch (err) {
            logError('setBackgroundHandler: Failed to read cached subscription_id in background:', err);
          }
        }

        // Background / terminated: display is the OS's job (FCM/APNs).
        // This handler only fires the delivery confirmation API.
        try {
          await NotifySphere.callbackOnDelivery(msg);
        } catch (err) {
          logError('setBackgroundHandler: Background delivery confirmation failed:', err);
        }
      } catch (err) {
        logError('setBackgroundHandler: Background message handler crashed:', err);
      }
    });
  } catch (err) {
    logError('setBackgroundHandler: failed to register FCM handler:', err);
  }

  // ── 4. Notifee background events ───────────────────────────────────────
  try {
    notifee.onBackgroundEvent(async ({type, detail}) => {
      try {
        log('Background notifee event, type:', type);
        if (type === EventType.PRESS && detail?.notification) {
          await NotifySphere.callbackOnpress(
            detail.notification as NotifeeNotification,
            'press',
          );
        }
      } catch (err) {
        logError('setBackgroundHandler: Background notifee event handler failed:', err);
      }
    });
  } catch (err) {
    logError('setBackgroundHandler: failed to register notifee background event:', err);
  }
}
  /**
   * Unsubscribes all active listeners and resets internal state.
   * This is local only — the device stays linked to the user server-side.
   * Use `logout()` on sign-out to detach the device from the user.
   */
  static destroy(): void {
    for (const unsub of NotifySphere.unsubscribers) {
      unsub();
    }
    NotifySphere.unsubscribers = [];
    NotifySphere.initialized = false;
    log('NotifySphere destroyed — all listeners removed');
  }

  // ─── Logout ──────────────────────────────────────────────────────────────

  /**
   * Detaches this device from the current user. Call on sign-out.
   *
   * 1. Removes listeners (so a token refresh can't re-register the old user).
   * 2. Marks this device's subscription as unsubscribed on the server.
   * 3. Deletes the FCM token (default) so the next sign-in gets a fresh token
   *    and the old one can no longer receive pushes.
   * 4. Clears the cached token, subscription_id and user hash so the next
   *    `initialize()` always re-registers.
   *
   * After this, call `initialize()` with the new user's `applicationUserId`.
   * Never throws — failures are logged and local state is still cleared.
   */
  static async logout(params?: {
    /** Delete the FCM token so the next sign-in registers a new one. Default: true */
    deleteToken?: boolean;
    /** Falls back to the appId provided in initialize() */
    appId?: string;
  }): Promise<void> {
    const appId = params?.appId ?? NotifySphere.appId;
    const shouldDeleteToken = params?.deleteToken ?? true;

    NotifySphere.destroy();

    const subscriptionId =
      NotifySphere.subscriptionId ??
      (await AsyncStorage.getItem(STORAGE_KEY_SUB_ID).catch(() => null));

    if (!appId) {
      warn('appId missing — cannot unregister device on server');
    } else if (!subscriptionId) {
      warn('subscription_id missing — nothing to unregister on server');
    } else {
      try {
        const res = await axios.post(
          `${NotifySphere.baseUrl}${appId}/logout`,
          { subscription_id: subscriptionId },
          {
            headers: {
              'Content-Type': 'application/json',
              ...(NotifySphere.apiKey
                ? { Authorization: `Bearer ${NotifySphere.apiKey}` }
                : {}),
            },
            timeout: 10000,
          }
        );
        log('Logout response:', res.data);
      } catch (err) {
        logError('Error unregistering device on logout:', err);
      }
    }

    if (shouldDeleteToken) {
      try {
        await messaging().deleteToken();
        log('FCM token deleted');
      } catch (err) {
        warn('Failed to delete FCM token:', err);
      }
    }

    NotifySphere.fcmToken = null;
    NotifySphere.subscriptionId = null;
    try {
      await AsyncStorage.multiRemove([
        STORAGE_KEY_TOKEN,
        STORAGE_KEY_SUB_ID,
        STORAGE_KEY_USER_HASH,
      ]);
    } catch (err) {
      warn('Failed to clear cached user state:', err);
    }
    log('NotifySphere logout complete');
  }

  // ─── Private: listeners ───────────────────────────────────────────────────

private static setupListeners(): void {
  // ✅ Foreground messages
  const unsubMessage = messaging().onMessage(async (remoteMessage) => {
   
   log('🔔 onMessage FIRED'); // ← yeh aata hai?
    const msg = remoteMessage as FirebaseRemoteMessage;
    log('🔔 MSG DATA:', JSON.stringify(msg));
    
    log('🔔 FOREGROUND onMessage fired:', JSON.stringify(msg));


    try {
      // ✅ Channel ensure karo pehle
      await NotifySphere.ensureChannel(
        'channel_default',
        'Default Channel',
        'default',
      );

       log('📢 notifee display calling...');

      await NotifySphere.displayLocalNotification(msg)

      

          log('✅ notifee display SUCCESS:', );
      log('✅ Foreground notification displayed successfully');
    } catch (err) {
      logError('❌ Foreground display error:', err);
    }

    // Delivery receipt + callback
    await NotifySphere.callbackOnDelivery(msg);
    NotifySphere.sendCallback(msg, 'received');
  });

  // App background se open via notification tap
  const unsubOpened = messaging().onNotificationOpenedApp(
    async (remoteMessage) => {
      log('App opened from background via notification:', remoteMessage.messageId);
      await NotifySphere.callbackOnpress(
        remoteMessage as FirebaseRemoteMessage,
        'opened',
      );
    },
  );

  // App terminated state se open via notification tap
  messaging()
    .getInitialNotification()
    .then(remoteMessage => {
      if (remoteMessage) {
        NotifySphere.callbackOnpress(
          remoteMessage as FirebaseRemoteMessage,
          'initial',
        );
      }
    })
    .catch(err => logError('getInitialNotification error:', err));

  // Notifee foreground press events
  const unsubForeground = notifee.onForegroundEvent(({type, detail}) => {
    if (type === EventType.PRESS && detail.notification) {
      NotifySphere.callbackOnpress(
        detail.notification as NotifeeNotification,
        'opened',
      );
    }
  });

  // ✅ Teeno unsubscribers push karo
  NotifySphere.unsubscribers.push(
    unsubMessage,
    unsubOpened,
    unsubForeground,
  );
}

  // ─── Private: backend channel helpers ────────────────────────────────────

  /** Maps the backend importance value to a Notifee AndroidImportance level. */
  private static mapImportance(value: number | undefined): AndroidImportance {
    const v = value ?? 3;
    if (v >= 4) return AndroidImportance.HIGH;
    if (v === 3) return AndroidImportance.DEFAULT;
    if (v === 2) return AndroidImportance.LOW;
    if (v === 1) return AndroidImportance.MIN;
    return AndroidImportance.DEFAULT;
  }

  /** Maps the backend lockScreen value to a Notifee AndroidVisibility level. */
  private static mapVisibility(lockScreen: number | undefined): AndroidVisibility {
    if (lockScreen === 1)  return AndroidVisibility.PUBLIC;
    if (lockScreen === -1) return AndroidVisibility.SECRET;
    return AndroidVisibility.PRIVATE;
  }

  /**
   * Creates Notifee channels from the array returned by the registration API.
   * Called immediately after registration and on every subsequent launch from
   * the AsyncStorage cache — so channels always exist before any notification
   * arrives, including in background / terminated state.
   */
  private static async createChannelsFromConfig(
    channels: BackendChannelConfig[]
  ): Promise<void> {
    for (const ch of channels) {
      // Map backend sound configuration to a Notifee-compatible value.
      // ALWAYS pass an explicit sound — Android channels are immutable after
      // creation, so omitting the field can leave the channel permanently
      // silent if anything (e.g. FCM auto-create on an older app version)
      // got there first.
      //
      //   'Custom' + soundDetail → raw resource name (extension stripped)
      //   'None'                 → '' (empty string = silent in Notifee)
      //   'Default' / anything   → 'default' (system default notification sound)
      let soundValue: string;
      if (ch.sound === 'Custom' && ch.soundDetail) {
        soundValue = ch.soundDetail.replace(/\..+$/, '');
      } else if (ch.sound === 'None') {
        soundValue = '';
      } else {
        soundValue = 'default';
      }

      const channelDef: AndroidChannel = {
        id:         ch.channel_id,
        name:       ch.name,
        importance: NotifySphere.mapImportance(ch.Importance),
        sound:      soundValue,
        lights:     (ch.LED ?? 0) === 1,
        vibration:  (ch.vibration ?? 0) === 1,
        visibility: NotifySphere.mapVisibility(ch.lockScreen),
        ...(ch.description ? { description: ch.description } : {}),
        ...(ch.led_color   ? { lightColor:  ch.led_color }   : {}),
      };

      await notifee.createChannel(channelDef);
      NotifySphere.createdChannels.add(ch.channel_id);
      log('Channel created from backend config:', ch.channel_id, `(${ch.name})`);
    }
  }

  // ─── Private: channel management ─────────────────────────────────────────

  /**
   * Creates a notification channel if it hasn't been created yet this session.
   * Notifee handles idempotency across app restarts; this in-memory guard
   * prevents redundant async calls within the same session.
   * No-op on iOS — channels are an Android-only concept.
   */
private static async ensureChannel(
  id: string,
  name: string,
  sound: string
): Promise<void> {
  if (Platform.OS !== 'android') return;
  if (NotifySphere.createdChannels.has(id)) return;

  const soundName = sound.replace(/\..+$/, '');

  const channelDef: AndroidChannel = {
    id,
    name,
    importance: AndroidImportance.HIGH,
    sound: soundName, // ✅ 'default' bhi explicitly set karo
    lights: true,
    lightColor: '#0000FF',
    vibration: true,
    visibility: AndroidVisibility.PUBLIC, // ✅ lock screen pe bhi dikhe
  };

  await notifee.createChannel(channelDef);
  NotifySphere.createdChannels.add(id);
  log('Android channel created/verified:', id);
}

  // ─── Private: display notification ───────────────────────────────────────

  /**
   * Builds and posts a notification via Notifee from a Firebase remote message.
   *
   * Not currently called by the SDK itself — `setBackgroundMessageHandler` no
   * longer renders notifications (the OS auto-displays them when the FCM
   * payload has a `notification` field, which is the common case). Kept on
   * the public surface so consumers who use data-only FCM payloads can call
   * it from their own `notifee.onBackgroundEvent` if they need JS-driven
   * display in background/terminated state.
   */
  static async displayLocalNotification(
    remoteMessage: FirebaseRemoteMessage
  ): Promise<void> {
    // Resolve sound: prefer data.sound, then notification.ios.sound, then 'default'.
    // On iOS, RNFB maps the FCM notification sound to notification.ios.sound,
    // which is either a plain string or a NotificationIOSCriticalSound object
    // { name, critical, volume }. There is NO top-level notification.sound field
    // on iOS — reading it always returns undefined.
    const iosNotifSound = remoteMessage.notification?.ios?.sound;
    const soundRaw =
      remoteMessage.data?.sound ||
      (typeof iosNotifSound === 'string' ? iosNotifSound : iosNotifSound?.name) ||
      'default';
    const soundName = soundRaw.replace(/\..+$/, '');

    // Resolve image — empty string treated same as missing
    const image =
      remoteMessage.data?.imageUrl ||
      remoteMessage.notification?.android?.imageUrl ||
      remoteMessage.notification?.imageUrl ||
      remoteMessage.notification?.ios?.attachments?.[0]?.url ||
      undefined;

    // Resolve title/body — empty string treated as missing
    const title =
      remoteMessage.data?.title || remoteMessage.notification?.title || undefined;
    const body =
      remoteMessage.data?.body || remoteMessage.notification?.body || undefined;

    if (Platform.OS === 'android') {
      // If the backend specifies a channelId (e.g. a UUID created on the dashboard),
      // use it directly — this lets the backend control which channel the notification
      // is assigned to. Otherwise fall back to a channel derived from the sound name.
      const channelId = remoteMessage.data?.channelId || `channel_${soundName}`;
      await NotifySphere.ensureChannel(channelId, `Channel ${soundName}`, soundRaw);

      // Resolve smallIcon and largeIcon — both fall back to
      // 'ic_stat_notifysphere_default' if not provided in the payload.
      // Add a drawable with this name to your app's res/drawable folder.
      const smallIconResolved =
        NotifySphere.resolveIcon(remoteMessage.data?.smallIcon) ??
        'ic_launcher';
      const largeIconResolved =
        NotifySphere.resolveIcon(remoteMessage.data?.largeIcon) ??
        'ic_launcher';

      // Determine Android expand style:
      //  - Image present → BIGPICTURE (shows image when expanded)
      //  - Long body (>44 chars) → BIGTEXT  (shows full text when expanded)
      //  - Otherwise → no style (single-line collapsed notification)
      const androidStyle = image
        ? ({ type: AndroidStyle.BIGPICTURE, picture: image } as const)
        : body && body.length > 44
          ? ({ type: AndroidStyle.BIGTEXT, text: body } as const)
          : undefined;

      await notifee.displayNotification({
        title,
        body,
        android: {
          channelId,
          smallIcon: smallIconResolved,
          largeIcon: largeIconResolved,
          style: androidStyle,
             pressAction: { id: 'default' },
      importance: AndroidImportance.HIGH,
      sound: soundName, // ✅ notification level pe bhi sound set karo
        },
        data: remoteMessage.data,
      });
    } else {
      // iOS foreground: APNs never auto-displays notifications while the app is
      // in the foreground, so Notifee must always display it manually.
      // Background: setBackgroundMessageHandler only fires for data-only FCM
      // messages (APNs intercepts notification-field messages before JS runs),
      // so Notifee display is always correct here too — no duplicate risk.

      // Resolve iOS sound — strip extension, Notifee expects just the resource name
      const iosSound = soundName === 'default' ? 'default' : soundRaw;

      log('📢 notifee display sound calling...',iosSound);

      await notifee.displayNotification({
        title,
        body,
        ios: {
          sound: iosSound,
          // Omit the key entirely when there is no image.
          // Passing `attachments: undefined` causes Notifee's native bridge to
          // throw "expected an array value", so we use spread instead of a
          // ternary that leaves the key present.
          ...(image ? { attachments: [{ url: image }] } : {}),
          foregroundPresentationOptions: {
            alert: true,
            badge: true,
            sound: true,
          },
        },
        data: remoteMessage.data,
      });
    }
  }

  /**
   * Returns the icon string if it is a real, usable value.
   * Treats empty string (""), "ic_stat_onesignal_default", and
   * any other placeholder-like value as absent (returns undefined).
   */
  private static resolveIcon(value: string | undefined): string | undefined {
    if (!value) return undefined; // catches "" / null / undefined
    return value;
  }

  /**
   * Rejects plain HTTP URLs to prevent user data (FCM token, email, phone,
   * location) being sent over an unencrypted connection.
   * Also ensures the URL ends with a trailing slash so appId is always
   * correctly appended (e.g. baseUrl + appId + '/users').
   */
  private static enforceHttps(url: string, ensureTrailingSlash = false): string {
    if (url.startsWith('http://')) {
      logError(
        `Insecure URL rejected: "${url}". NotifySphere only allows HTTPS endpoints.`
      );
      throw new Error(
        `NotifySphere: insecure HTTP URL is not allowed — use HTTPS instead.`
      );
    }
    if (ensureTrailingSlash && !url.endsWith('/')) {
      return url + '/';
    }
    return url;
  }

  // ─── Private: fire consumer callback ─────────────────────────────────────

  /**
   * Normalises both Firebase remote messages and Notifee notification objects
   * into the common NotificationData shape and fires the consumer callback.
   */
  private static sendCallback(
    notification: FirebaseRemoteMessage | NotifeeNotification,
    type?: string
  ): void {
    if (!NotifySphere.callback) return;

    // Detect shape: Firebase messages have a `notification` or `messageId` field
    const isFirebase =
      'notification' in notification || 'messageId' in notification;

    let title: string | undefined;
    let body: string | undefined;
    let data: Record<string, string> | undefined;
    let image: string | undefined;
    let sound: string | undefined;

    if (isFirebase) {
      const msg = notification as FirebaseRemoteMessage;
      title = msg.notification?.title ?? msg.data?.title;
      body = msg.notification?.body ?? msg.data?.body;
      data = msg.data;
      image =
        msg.notification?.android?.imageUrl ||
        msg.notification?.imageUrl ||
        msg.notification?.ios?.attachments?.[0]?.url ||
        msg.data?.imageUrl;
      sound = msg.data?.sound;
    } else {
      const notif = notification as NotifeeNotification;
      title = notif.title;
      body = notif.body;
      data = notif.data;
      image = notif.data?.imageUrl;
      sound = notif.data?.sound;
    }

    NotifySphere.callback({ title, body, data, image, sound }, type);
  }
}

export default NotifySphere;



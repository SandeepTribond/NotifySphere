import messaging from '@react-native-firebase/messaging';
import DeviceInfo from 'react-native-device-info';
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

// ─── Type definitions ──────────────────────────────────────────────────────────

/** Shape of a Firebase Cloud Messaging remote message */
export interface FirebaseRemoteMessage {
  messageId?: string;
  notification?: {
    title?: string;
    body?: string;
    android?: { imageUrl?: string };
    ios?: { attachments?: Array<{ url?: string }> };
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

const SDK_VERSION = '1.2.1';

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

const DEFAULT_BASE_URL = 'https://api.notifysphere.in/client/';
// const DEFAULT_BASE_URL = 'https://apinotify.dothejob.in';
//const DEFAULT_BASE_URL = 'https://apinotify.dothejob.in/client/';

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
    try {
      if (Platform.OS === 'android' && Platform.Version >= 33) {
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS
        );
        return granted === PermissionsAndroid.RESULTS.GRANTED;
      } else if (Platform.OS === 'ios') {
        const authStatus = await messaging().requestPermission();
        return (
          authStatus === messaging.AuthorizationStatus.AUTHORIZED ||
          authStatus === messaging.AuthorizationStatus.PROVISIONAL
        );
      }
      return true;
    } catch (err) {
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

    const hasPermission = await NotifySphere.checkApplicationPermission();
    if (!hasPermission) {
      warn('Notification permission not granted — aborting initialization');
      return undefined;
    }

    try {
      const fcmToken = await messaging().getToken();
      NotifySphere.fcmToken = fcmToken;

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
      if (cachedChannels) {
        const channels = JSON.parse(cachedChannels) as BackendChannelConfig[];
        await NotifySphere.createChannelsFromConfig(channels);
        log('Channels restored from cache:', channels.length);
      }

      const currentUserHash = NotifySphere.buildUserHash(config);
      let subscriptionId: string | undefined = cachedSubId ?? undefined;

      const tokenChanged = fcmToken !== cachedToken;
      const userChanged = currentUserHash !== cachedUserHash;

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

      // ── Channel and listeners are always set up (idempotent)
      await NotifySphere.ensureChannel(
        'channel_default',
        'Default Channel',
        'default'
      );

      if (!NotifySphere.initialized) {
        NotifySphere.setupListeners();
        // Watch for token refreshes (Firebase can rotate the token silently)
        NotifySphere.watchTokenRefresh(config);
        NotifySphere.initialized = true;
      }

      return subscriptionId;
    } catch (err) {
      logError('Error during initialization:', err);
      return undefined;
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
    // This ensures every backend-configured channel exists on the device
    // before any background / terminated-state notification can arrive.
    const channels: BackendChannelConfig[] | undefined =
      res.data?.notification_channels;
    if (channels && channels.length > 0) {
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
     * Required for delivery receipts to include subscription_id when the app
     * is terminated (since initialize() won't have run yet).
     * Persist this value (e.g. in AsyncStorage) and pass it here.
     */
    subscriptionId?: string;
  }): void {
    // Apply any config overrides immediately — before the handler fires —
    // so they are in place even when the app starts from a terminated state.
    if (config?.deliveryUrl) {
      NotifySphere.deliveryUrl = NotifySphere.enforceHttps(config.deliveryUrl);
    }
    if (config?.apiKey) {
      NotifySphere.apiKey = config.apiKey;
    }
    if (config?.subscriptionId) {
      NotifySphere.subscriptionId = config.subscriptionId;
    }

    // Pre-create the default channel immediately so it is guaranteed to exist
    // (with sound enabled) before any background or terminated-state message
    // arrives. Without this, the channel would be created inside the async
    // background handler — on some devices that races with the notification
    // display and results in a silent notification.
    notifee.createChannel({
      id: 'channel_default',
      name: 'Default Channel',
      importance: AndroidImportance.HIGH,
      lights: true,
      lightColor: '#0000FF',
      vibration: true,
    });

    messaging().setBackgroundMessageHandler(async (remoteMessage) => {
      const msg = remoteMessage as FirebaseRemoteMessage;

      // Always display via Notifee so the backend-configured channel (with its
      // custom sound, importance, and LED settings) is used in every state.
      //
      // On iOS, setBackgroundMessageHandler never fires for messages that
      // contain a `notification` field — APNs intercepts them — so there is
      // no duplicate risk on iOS.
      //
      // On Android, if the FCM payload contains a `notification` field, FCM
      // will also auto-display, which causes a duplicate notification. To avoid
      // this, the backend should send data-only messages to Android tokens
      // (omit the top-level `notification` field). Notifee then has full
      // control over display and sound in all states.
      await Promise.all([
        NotifySphere.displayLocalNotification(msg),
        NotifySphere.callbackOnDelivery(msg),
      ]);
    });

    notifee.onBackgroundEvent(async ({ type, detail }) => {
      log('Background notifee event, type:', type);
      if (type === EventType.PRESS && detail.notification) {
        await NotifySphere.callbackOnpress(
          detail.notification as NotifeeNotification,
          'press'
        );
      }
    });
  }

  // ─── Cleanup ──────────────────────────────────────────────────────────────

  /**
   * Unsubscribes all active listeners and resets internal state.
   * Call this when you want to stop receiving notifications (e.g. on logout).
   */
  static destroy(): void {
    for (const unsub of NotifySphere.unsubscribers) {
      unsub();
    }
    NotifySphere.unsubscribers = [];
    NotifySphere.initialized = false;
    log('NotifySphere destroyed — all listeners removed');
  }

  // ─── Private: listeners ───────────────────────────────────────────────────

  private static setupListeners(): void {
    // Foreground messages — display, send delivery receipt, and fire callback
    const unsubMessage = messaging().onMessage(async (remoteMessage) => {
      const msg = remoteMessage as FirebaseRemoteMessage;
      log('Foreground message received:', msg);
      // Display and delivery receipt run in parallel for speed
      
      await Promise.all([
        NotifySphere.displayLocalNotification(msg),
        NotifySphere.callbackOnDelivery(msg),
      ]);
      NotifySphere.sendCallback(msg, 'received');
    });

    // App brought from background via notification tap
    const unsubOpened = messaging().onNotificationOpenedApp(
      async (remoteMessage) => {
        log(
          'App opened from background via notification:',
          remoteMessage.messageId
        );
        await NotifySphere.callbackOnpress(
          remoteMessage as FirebaseRemoteMessage,
          'opened'
        );
      }
    );

    // App launched from a quit state via notification tap
    messaging()
      .getInitialNotification()
      .then((remoteMessage) => {
        if (remoteMessage) {
          NotifySphere.callbackOnpress(
            remoteMessage as FirebaseRemoteMessage,
            'initial'
          );
        }
      })
      .catch((err) => logError('getInitialNotification error:', err));

    // Notifee foreground press events (covers in-app notification taps)
    const unsubForeground = notifee.onForegroundEvent(({ type, detail }) => {
      if (type === EventType.PRESS && detail.notification) {
        NotifySphere.callbackOnpress(
          detail.notification as NotifeeNotification,
          'opened'
        );
      }
    });

    NotifySphere.unsubscribers.push(
      unsubMessage,
      unsubOpened,
      unsubForeground
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
      // sound === 'Custom'  → use soundDetail as the raw resource name
      // sound === 'None'    → no sound (don't spread sound key)
      // sound === 'Default' → omit key so Android uses system default
      let soundValue: string | undefined;
      if (ch.sound === 'Custom' && ch.soundDetail) {
        soundValue = ch.soundDetail.replace(/\..+$/, ''); // strip extension
      }
      // 'None' and 'Default' intentionally leave soundValue as undefined

      console.log('this is sound value',soundValue)

      const channelDef: AndroidChannel = {
        id:         ch.channel_id,
        name:       ch.name,
        importance: NotifySphere.mapImportance(ch.Importance),
        lights:     (ch.LED ?? 0) === 1,
        vibration:  (ch.vibration ?? 0) === 1,
        visibility: NotifySphere.mapVisibility(ch.lockScreen),
        ...(ch.description ? { description: ch.description } : {}),
        ...(ch.led_color   ? { lightColor:  ch.led_color }   : {}),
        // Only spread sound when it is a real custom resource name.
        // For 'Default', omitting the key tells Android to use the system
        // default sound. For 'None', omitting it silences the channel only
        // if importance is set to LOW/MIN — HIGH importance always plays sound.
        ...(soundValue     ? { sound: soundValue }           : {}),
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
   */
  private static async ensureChannel(
    id: string,
    name: string,
    sound: string
  ): Promise<void> {
    if (NotifySphere.createdChannels.has(id)) return;

    const soundName = sound.replace(/\..+$/, '');
    const channelDef: AndroidChannel = {
      id,
      name,
      importance: AndroidImportance.HIGH,
      // For custom sounds, use the raw resource name (without extension).
      // For 'default', omit the field entirely so Android uses the device's
      // default notification sound. Setting it to undefined explicitly can
      // be treated as "no sound" by Notifee on some devices.
      ...(soundName !== 'default' ? { sound: soundName } : {}),
      lights: true,
      lightColor: '#0000FF',
      vibration: true,
    };

    await notifee.createChannel(channelDef);
    NotifySphere.createdChannels.add(id);
    log('Android channel created/verified:', id);
  }

  // ─── Private: display notification ───────────────────────────────────────

  private static async displayLocalNotification(
    remoteMessage: FirebaseRemoteMessage
  ): Promise<void> {
    // Use || so empty strings fall back just like null/undefined
    const soundRaw = remoteMessage.data?.sound || 'default';
    const soundName = soundRaw.replace(/\..+$/, '');

    // If the backend specifies a channelId (e.g. a UUID created on the dashboard),
    // use it directly — this lets the backend control which channel the notification
    // is assigned to. Otherwise fall back to a channel derived from the sound name.
    const channelId = remoteMessage.data?.channelId || `channel_${soundName}`;

    await NotifySphere.ensureChannel(channelId, `Channel ${soundName}`, soundRaw);

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

    // Resolve smallIcon and largeIcon — both fall back to
    // 'ic_stat_notifysphere_default' if not provided in the payload.
    // Add a drawable with this name to your app's res/drawable folder.
    const smallIconResolved =
      NotifySphere.resolveIcon(remoteMessage.data?.smallIcon) ??
      'ic_stat_notifysphere_default';
    const largeIconResolved =
      NotifySphere.resolveIcon(remoteMessage.data?.largeIcon) ??
      'ic_stat_notifysphere_default';

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
      },
      ios: {
        sound: soundRaw,
        attachments: image ? [{ url: image }] : undefined,
        foregroundPresentationOptions: {
          alert: true,
          badge: true,
          sound: true,
        },
      },
      data: remoteMessage.data,
    });
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

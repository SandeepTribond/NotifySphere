import messaging from '@react-native-firebase/messaging';
import notifee, {
  AndroidImportance,
  AndroidStyle,
  EventType,
} from '@notifee/react-native';
import axios from 'axios';
import { PermissionsAndroid, Platform } from 'react-native';

type NotificationData = {
  title?: string;
  body?: string;
  data?: any;
  image?: string;
  sound?: string;
};

type NotificationCallback = (
  notification: NotificationData,
  type?: string
) => void;

class NotifySphere {
  private static callback: NotificationCallback | null = null;
  private static fcmToken: string | null = null;

  // ========= Press callback (tracking) =========
  static async callbackOnpress(remoteMessage: any, status: string) {
    console.log('remoteMessage413123', remoteMessage);
    try {
      const data = JSON.stringify({
        notifiction_id: remoteMessage?.data?.notification_id,
        onPressStatus: 1,
      });

      const config = {
        method: 'post' as const,
        maxBodyLength: Infinity,
        url: 'https://notifysphere.dothejob.in:3008/onpress/handle',
        headers: {
          'Content-Type': 'application/json',
          'Cookie':
            'token=sYPT8POivlxfFSR54MWd3reaArvODMiIcM4KM39cqkXBLVu%2B8b1zV2csabU9byzo',
        },
        data,
      };

      const response = await axios.request(config);
      console.log('onPress API response:', response.data);

      NotifySphere.sendCallback(remoteMessage, status);
    } catch (error) {
      console.error('Error in callbackOnpress:', error);
    }
  }

  // ========= Permissions =========
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
    } catch (error) {
      console.error('Error requesting notification permission:', error);
      return false;
    }
  }

  // ========= Initialize + register user (with tags) =========
  static async initialize(config: {
    applicationUserId: number;
    type: string;
    name?: string;
    lat?: string;
    long?: string;
    city?: string;
    state?: string;
    email?: string;
    appId?: string;
    phone?: number;
    tags?: Record<string, any>;
  }) {
    const hasPermission = await NotifySphere.checkApplicationPermission();
    if (!hasPermission) return;

    const fcmToken = await messaging().getToken();
    NotifySphere.fcmToken = fcmToken;
    console.log('fcmToken31232', fcmToken, config);

    if (!config.appId) return;

    let subscription_id = await axios
      .post(
        `https://notifysphere.dothejob.in:3008/apps/${config.appId}/users`,
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
          },
        },
        {
          headers: { 'Content-Type': 'application/json' },
          maxBodyLength: Infinity,
        }
      )
      .then((res: any) => {
        console.log('res313132', res.data);
        return res.data.subscription_id;
      })
      .catch((err) => {
        console.log('err31232', err);
      });

    NotifySphere.setupListeners();
    return subscription_id;
  }

  // ========= Update tags only (later) =========
  static async updateTags(params: {
    appId: string;
    applicationUserId: number;
    type: string;
    tags: Record<string, any>;
  }) {
    try {
      if (!NotifySphere.fcmToken) {
        console.warn('NotifySphere: FCM token missing, cannot update tags');
        return null;
      }

      const res = await axios.post(
        `https://notifysphere.dothejob.in:3008/apps/${params.appId}/users`,
        {
          applicationUserId: params.applicationUserId,
          token: NotifySphere.fcmToken,
          type: params.type,
          user: {
            tags: params.tags, // ✅ only tags
          },
        },
        {
          headers: { 'Content-Type': 'application/json' },
          maxBodyLength: Infinity,
        }
      );

      console.log('tags update response:', res.data);
      return res.data;
    } catch (error) {
      console.error('Error updating tags:', error);
      return null;
    }
  }

  // ========= Public callback setter =========
  static onNotification(callback: NotificationCallback) {
    NotifySphere.callback = callback;
  }

  // ========= Listeners =========
  private static setupListeners() {
    messaging().onMessage(async (remoteMessage) => {
      await NotifySphere.displayLocalNotification(remoteMessage);
    });

    messaging().onNotificationOpenedApp(async (remoteMessage: any) => {
      console.log('data34234', remoteMessage);
      NotifySphere.callbackOnpress(remoteMessage, 'opened');
    });

    messaging()
      .getInitialNotification()
      .then((remoteMessage) => {
        if (remoteMessage) {
          NotifySphere.callbackOnpress(remoteMessage, 'initial');
        }
      });

    notifee.onForegroundEvent(({ type, detail }) => {
      if (type === EventType.PRESS) {
        console.log('detail323213', detail);
        NotifySphere.callbackOnpress(detail.notification, 'opened');
      }
    });

    notifee.onBackgroundEvent(async ({ type, detail }) => {
      console.log('detail323213111111', type, detail);

      if (type === EventType.PRESS) {
        console.log('detail323213', detail);
        NotifySphere.callbackOnpress(detail.notification, 'press');
      }
    });
  }

  // ========= Local notification display =========
  private static async displayLocalNotification(remoteMessage: any) {
    const soundRaw = remoteMessage.data?.sound || 'default';
    const androidChannelId = `channel_${soundRaw}`;
    const androidSoundName = soundRaw.replace(/\..+$/, '');
    console.log('remoteMessage1312', remoteMessage);

    await notifee.createChannel({
      id: androidChannelId,
      name: `Channel ${androidSoundName}`,
      importance: AndroidImportance.HIGH,
      sound: androidSoundName !== 'default' ? androidSoundName : undefined,
    });

    const image =
      remoteMessage?.data?.fcm_options?.image ||
      remoteMessage.notification?.android?.imageUrl ||
      remoteMessage.notification?.imageUrl ||
      remoteMessage.notification?.ios?.attachments?.[0]?.url;

    await notifee.displayNotification({
      title: remoteMessage.notification?.title,
      body: remoteMessage.notification?.body,
      android: {
        channelId: androidChannelId,
        importance: AndroidImportance.HIGH,
        sound: androidSoundName !== 'default' ? androidSoundName : undefined,
        largeIcon: image,
        style: image
          ? {
              type: AndroidStyle.BIGPICTURE,
              picture: image,
            }
          : undefined,
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

  // ========= App-level callback trigger =========
  private static sendCallback(remoteMessage: any, type?: string) {
    if (!NotifySphere.callback) return;

    const image =
      remoteMessage.notification?.android?.imageUrl ||
      remoteMessage.notification?.imageUrl ||
      remoteMessage.notification?.ios?.attachments?.[0]?.url;

    NotifySphere.callback(
      {
        title: remoteMessage.notification?.title,
        body: remoteMessage.notification?.body,
        data: remoteMessage.data,
        image,
        sound: remoteMessage.data?.sound,
      },
      type
    );
  }
}

export default NotifySphere;

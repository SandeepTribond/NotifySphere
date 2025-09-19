import messaging from '@react-native-firebase/messaging';
import notifee, {
  AndroidImportance,
  AndroidStyle,
  EventType, // Import EventType if available
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

  // ✅ Permission check remains fully here
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
  }) {
    const hasPermission = await NotifySphere.checkApplicationPermission();
    if (!hasPermission) return;

    const fcmToken = await messaging().getToken();
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
          },
        },
        {
          headers: { 'Content-Type': 'application/json' },
          maxBodyLength: Infinity,
        }
      )
      .then((res: any) => {
        console.log('res312331', res);
        return res.data.subscription_id;
      });

    NotifySphere.setupListeners();
    return subscription_id;
  }

  static onNotification(callback: NotificationCallback) {
    NotifySphere.callback = callback;
  }

  private static setupListeners() {
    messaging().onMessage(async (remoteMessage) => {
      await NotifySphere.displayLocalNotification(remoteMessage);
    });

    messaging().onNotificationOpenedApp((remoteMessage) => {
      console.log('data34234', remoteMessage);

      NotifySphere.sendCallback(remoteMessage, 'opened');
    });

    messaging()
      .getInitialNotification()
      .then((remoteMessage) => {
        if (remoteMessage) NotifySphere.sendCallback(remoteMessage, 'initial');
      });

    notifee.onForegroundEvent(({ type, detail }) => {
      if (type === EventType.PRESS) {
        NotifySphere.sendCallback(detail.notification, 'press');
      }
    });

    notifee.onBackgroundEvent(async ({ type, detail }) => {
      if (type === EventType.PRESS) {
        NotifySphere.sendCallback(detail.notification, 'press');
      }
    });
  }

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
        sound: soundRaw, // must be a bundled sound file or "default"
        attachments: image ? [{ url: image }] : undefined, // ✅ this is correct
        foregroundPresentationOptions: {
          alert: true,
          badge: true,
          sound: true,
        },
      },
      data: remoteMessage.data,
    });
  }

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

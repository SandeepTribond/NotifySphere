import { useEffect } from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import NotifySphere from 'react-native-notify-sphere';

// Get these from the notifySphere dashboard (App settings → API keys).
// Never commit real keys: this repository is public.
export const APP_ID = 'YOUR_APP_ID';
export const API_TOKEN = 'YOUR_API_TOKEN';

const PUSH_TYPE = Platform.OS === 'android' ? 'AndroidPush' : 'IOSPush';

export default function App() {
  useEffect(() => {
    const init = async () => {
      // Safe to call every app open — only hits the registration API when
      // the FCM token has changed. Token + subscription_id are persisted
      // automatically by the SDK.
      const subscriptionId = await NotifySphere.initialize({
        applicationUserId: 1,
        type: PUSH_TYPE,
        appId: APP_ID,
        apiKey: API_TOKEN,
        name: 'Madhav Ballabh Kakkar',
        lat: '26.9124',
        long: '75.7873',
        city: 'Jaipur',
        state: 'Rajasthan',
        email: 'madhav@example.com',
        phone: '9983101939',
        debug: __DEV__,
      });

      if (__DEV__) {
        console.log('NotifySphere subscriptionId:', subscriptionId);
      }

      await NotifySphere.updateTags({
        applicationUserId: 1,
        type: PUSH_TYPE,
        tags: {
          gender: 'male',
          premium: 'true',
          age: '33',
        },
      });

      
      // Example: post a campaign conversion event.
      // In a real app, call this after the user completes the target action
      // (e.g. booking confirmation). Pass `nsClick` when it is available from
      // the campaign deep-link (the `ns_click` query param in the incoming URL).
      const eventResult = await NotifySphere.postEvent({
        event: 'booking',
        appId: APP_ID,
        nsClick: '7b789ef3-8cf9-4caa-b796-e98a6f1ed5d8', // replace with real value from deep-link
        data: {
          revenue: 2350,
          quantity: 2,
          tax: 450,
          order_id: 'ORD23',
        },
      });



      if (__DEV__) {
        console.log('NotifySphere postEvent result:', eventResult);
      }
    };

    init();

    NotifySphere.onNotification((notification, type) => {
      if (__DEV__) {
        console.log('[App] Notification event:', type, notification);
      }

      if (type === 'press' || type === 'opened' || type === 'initial') {
        // Handle notification tap — navigate, show modal, etc.
      }

      if (type === 'received') {
        // Notification arrived in the foreground
      }
    });

    // Clean up listeners when the component unmounts
    return () => {
      NotifySphere.destroy();
    };
  }, []);

  return (
    <View style={styles.container}>
      <Text>Result: Success</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

import { useEffect } from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import NotifySphere from 'react-native-notify-sphere';

// const APP_ID = 'b9f4dee6-90bf-a73b-057a-a7091a0a9048';
// export const API_TOKEN = 'ns_sk_lskqj4XRX0GR77AsN_DMrVxhr5bwvetRwSuSafVn5UI'; // Replace with your app's Bearer token


const APP_ID = 'c7b3c35c-f2d1-9dee-e7ee-66b688396dba';
export const API_TOKEN = 'ns_sk_-JlEDcpsNvEsgWAdGWeAnWpB2eEPobJO1Pc35DmsQcE'; // Replace with your app's Bearer token



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

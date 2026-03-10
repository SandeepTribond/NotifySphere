import { useEffect } from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import NotifySphere from 'react-native-notify-sphere';

export default function App() {
  useEffect(() => {
    const init = async () => {
      const subscriptionId = await NotifySphere.initialize({
        applicationUserId: 1,
        type: Platform.OS === 'android' ? 'AndroidPush' : 'IOSPush',
        name: 'Madhav Ballabh Kakkar',
        lat: '26.9124',
        long: '75.7873',
        city: 'Jaipur',
        state: 'Rajasthan',
        email: 'madhav@example.com',
        appId: 'c7b3c35c-f2d1-9dee-e7ee-66b688396dba',
        phone: 9983101939,
      });

      console.log('NotifySphere subscriptionId:', subscriptionId);

      NotifySphere.updateTags({
        appId: 'c7b3c35c-f2d1-9dee-e7ee-66b688396dba',
        applicationUserId: 1,
        type: Platform.OS === 'android' ? 'AndroidPush' : 'IOSPush',
        tags: {
          gender: 'male',
          premium: 'true',
          age: '33',
        },
      });
    };

    init();

    NotifySphere.onNotification((notification, type) => {
      console.log('Notification received:', notification, type);
      console.log('Event type:', type);
      if (type === 'press' || type === 'opened' || type === 'initial') {
        console.log('helloKitty');
      }
    });
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

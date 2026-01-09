import React, { useEffect } from 'react';
import { View, Text, StyleSheet, Platform, Alert } from 'react-native';
import NotifySphere from 'react-native-notify-sphere';
import notifee, { EventType } from '@notifee/react-native';

export default function App() {
  useEffect(() => {
    NotifySphere.initialize({
      applicationUserId: 1,
      type: Platform.OS === 'android' ? 'AndroidPush' : 'IOSPush',
      name: 'Madhav Ballabh Kakkar',
      lat: '26.9124',
      long: '75.7873',
      city: 'Jaipur',
      state: 'Rajasthan',
      email: 'madhav@example.com',
      appId: '253b13cc-7dcb-2dcc-8dde-565433ec8d15',
      phone: 9983101939,
      tags: { gender: 'male', plan: 'gold' }
    }).then((res: any) => {
      console.log('res312323', res);
    });

    NotifySphere.onNotification((notification, type) => {
      console.log('Notification received:', notification, type);
      console.log('Event type:', type);
      if (type === 'press' || type === 'opened' || type == 'initial') {
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

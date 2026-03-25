import { AppRegistry } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import App from './src/App';
import { name as appName } from './app.json';
import NotifySphere from 'react-native-notify-sphere';
import { API_TOKEN } from './src/App';

const STORAGE_KEY = '@notifysphere_subscription_id';

// Load the persisted subscription_id so delivery receipts include it
// even when the app is started from a terminated state.
AsyncStorage.getItem(STORAGE_KEY).then((subscriptionId) => {
  NotifySphere.setBackgroundHandler({
    // deliveryUrl: 'https://your-server.com/delivery/confirm', // optional
    apiKey: API_TOKEN,
    subscriptionId: subscriptionId ?? undefined,
  });
});

AppRegistry.registerComponent(appName, () => App);

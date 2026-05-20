import { AppRegistry } from 'react-native';
import App from './src/App';
import { name as appName } from './app.json';
import NotifySphere from 'react-native-notify-sphere';
import { API_TOKEN, APP_ID } from './src/App';

// ─────────────────────────────────────────────────────────────────────────────
// IMPORTANT: setBackgroundHandler MUST be called synchronously at the top of
// this file, before AppRegistry.registerComponent. Firebase requires the
// background message handler to be registered at module-evaluation time —
// wrapping it in an async callback (e.g. AsyncStorage.getItem().then(...))
// causes background/terminated-state messages to be dropped because no handler
// is registered yet when the headless JS task starts.
//
// Pass `appId` so the SDK can derive the default deliveryUrl when the app is
// launched from a killed state (initialize() has not run yet in that case).
// The subscription_id is read from AsyncStorage inside the handler itself,
// where async work is safe.
// ─────────────────────────────────────────────────────────────────────────────
NotifySphere.setBackgroundHandler({
  appId: APP_ID,
  apiKey: API_TOKEN,
  // deliveryUrl: 'https://your-server.com/delivery/confirm', // optional override
});

AppRegistry.registerComponent(appName, () => App);

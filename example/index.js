import { AppRegistry } from 'react-native';
import App from './src/App';
import { name as appName } from './app.json';
import NotifySphere from 'react-native-notify-sphere';

// Must be called before AppRegistry so handlers are registered
// for background and killed app states
NotifySphere.setBackgroundHandler();

AppRegistry.registerComponent(appName, () => App);

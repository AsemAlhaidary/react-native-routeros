import { type ConfigPlugin, withPlugins } from 'expo/config-plugins';
import { withAndroidPlugin } from './withAndroid';
import { withIosPlugin } from './withIos';

/**
 * Expo config plugin for react-native-routeros.
 *
 * Add `react-native-routeros` to your app.json `plugins` array and run
 * `npx expo prebuild` to auto-link react-native-tcp-socket and apply the Android
 * manifest mutations (INTERNET permission + usesCleartextTraffic) required for
 * plain-TCP access to MikroTik RouterOS devices.
 */
const withReactNativeRouterOS: ConfigPlugin = (config) => {
  return withPlugins(config, [withAndroidPlugin, withIosPlugin]);
};

export default withReactNativeRouterOS;

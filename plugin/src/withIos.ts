import {
  type ConfigPlugin,
  WarningAggregator,
  withDangerousMod,
} from 'expo/config-plugins';

const TCP_SOCKET_PACKAGE = 'react-native-tcp-socket';

/**
 * EXPO-01 (iOS half): verify react-native-tcp-socket is installed so its CocoaPods
 * pod is autolinked during `pod install`. Emits a non-fatal warning when the module
 * is absent (iOS networking is handled by the same native module) rather than
 * throwing, since a consumer could plausibly link it manually.
 */
export const withIosPlugin: ConfigPlugin = (config) => {
  return withDangerousMod(config, [
    'ios',
    (config) => {
      try {
        require.resolve(`${TCP_SOCKET_PACKAGE}/package.json`, {
          paths: [config.modRequest.projectRoot],
        });
      } catch {
        WarningAggregator.addWarningIOS(
          'react-native-routeros',
          `${TCP_SOCKET_PACKAGE} was not found in node_modules. ` +
            'It is required for RouterOS TCP/TLS access. ' +
            `Install it with: npm install ${TCP_SOCKET_PACKAGE}`,
        );
      }
      return config;
    },
  ]);
};

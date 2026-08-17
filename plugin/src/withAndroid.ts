import {
  AndroidConfig,
  type ConfigPlugin,
  withAndroidManifest,
  withDangerousMod,
} from 'expo/config-plugins';

const TCP_SOCKET_PACKAGE = 'react-native-tcp-socket';
const INTERNET_PERMISSION = 'android.permission.INTERNET';

/**
 * Resolve `react-native-tcp-socket` from the consumer's node_modules to confirm the
 * native module is installed and therefore eligible for React Native autolinking.
 * Throws a descriptive error if the module is missing so the consumer knows why
 * prebuild cannot wire up raw TCP access to RouterOS devices.
 */
function assertTcpSocketAvailable(projectRoot: string): void {
  try {
    require.resolve(`${TCP_SOCKET_PACKAGE}/package.json`, { paths: [projectRoot] });
  } catch {
    throw new Error(
      `[react-native-routeros] ${TCP_SOCKET_PACKAGE} was not found in node_modules. ` +
        'It is a required peer dependency for raw TCP access to RouterOS devices. ' +
        `Install it with: npm install ${TCP_SOCKET_PACKAGE}`,
    );
  }
}

/**
 * EXPO-01: verify react-native-tcp-socket is installed so React Native autolinking
 * can register the native module during prebuild.
 * EXPO-02: add the INTERNET permission and set android:usesCleartextTraffic="true" so
 * plain-TCP connections to RouterOS (default port 8728) are permitted.
 */
export const withAndroidPlugin: ConfigPlugin = (config) => {
  config = withDangerousMod(config, [
    'android',
    (config) => {
      assertTcpSocketAvailable(config.modRequest.projectRoot);
      return config;
    },
  ]);

  config = withAndroidManifest(config, (config) => {
    const manifest = config.modResults;

    AndroidConfig.Permissions.ensurePermissions(manifest, [INTERNET_PERMISSION]);

    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(manifest);
    application.$['android:usesCleartextTraffic'] = 'true';

    return config;
  });

  return config;
};

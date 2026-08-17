# react-native-routeros — Installation

Install `react-native-routeros` on Bare React Native or an Expo custom dev client. The library talks to MikroTik RouterOS devices over the RouterOS API protocol (raw TCP) using the `react-native-tcp-socket` native module — there is no Node.js runtime involved, and no pure-JavaScript fallback for the socket layer.

> **Expo Go is NOT supported.** The library requires the `react-native-tcp-socket` native module, which Expo Go does not bundle. You must use a custom dev client (see [Expo](#expo-custom-dev-client) below).

---

## Prerequisites

1. **Node.js** and an existing React Native project (Bare RN or an Expo CNG project).
2. **A MikroTik RouterOS device** with the API service enabled. From the router's terminal:

   ```
   /ip service set api port=8728 disabled=no
   ```

   The default API port is **8728** (plain TCP) or **8729** (TLS, RouterOS ≥ 6.43). Enable TLS with:

   ```
   /ip service set api-ssl port=8729 disabled=no
   ```

3. Credentials for a RouterOS user (v6/v7) with permission to run the API commands your app needs.

---

## Bare React Native

### 1. Install the library

```bash
npm install react-native-routeros
```

### 2. Install the peer dependencies

The library declares three `peerDependencies` — `react`, `react-native`, and `react-native-tcp-socket` — which must be present in your project. Install them explicitly:

```bash
npm install react react-native react-native-tcp-socket
```

| Package | Version | Role |
|---------|---------|------|
| `react` | `*` | Peer — required by the React Native runtime |
| `react-native` | `*` | Peer — required by the React Native runtime |
| `react-native-tcp-socket` | `^6.4.2` | Peer — the native TCP/TLS transport; must be autolinked |

`react-native-tcp-socket` is the **only** native dependency and autolinks on React Native 0.60+. You must install it yourself because it is not bundled with React Native. Every other runtime dependency (`debug`, `events`, `js-md5`) is pure JavaScript.

### 3. Install iOS pods

After adding the native module, install the CocoaPods dependency:

```bash
cd ios && pod install && cd ..
```

### 4. Rebuild

Rebuild the app for each platform:

```bash
npx react-native run-android
# or
npx react-native run-ios
```

---

## Expo (custom dev client)

The library ships an Expo config plugin for Continuous Native Generation (CNG) projects.

### 1. Install the library and the native socket module

```bash
npm install react-native-routeros react-native-tcp-socket
```

### 2. Add the config plugin

Add `"react-native-routeros"` to the `plugins` array in your `app.json`:

```json
{
  "expo": {
    "plugins": ["react-native-routeros"]
  }
}
```

### 3. Generate the native project

```bash
npx expo prebuild
```

### 4. Run on a device or emulator

```bash
npx expo run:ios
# or
npx expo run:android
```

> **Expo Go is NOT supported.** `react-native-routeros` requires the `react-native-tcp-socket` native module, which Expo Go does not bundle and cannot load. Run via a custom dev client (`npx expo prebuild` + `npx expo run:ios` / `npx expo run:android`, or EAS Build). Do not attempt to use Expo Go — the connection will fail because the native TCP module is unavailable.

---

## Config plugin behavior

The plugin (`plugin/src/index.ts`) chains two platform modifiers during prebuild:

### Android (`plugin/src/withAndroid.ts`)

- **Verifies `react-native-tcp-socket` is installed** — resolves the module from `node_modules` and throws a descriptive error if it is missing, so React Native autolinking can register the native module.
- **Adds the `android.permission.INTERNET` permission** to the Android manifest.
- **Sets `android:usesCleartextTraffic="true"`** so plain-TCP connections to RouterOS (default port 8728) are permitted. If you connect only over TLS (port 8729), cleartext traffic is not required.

### iOS (`plugin/src/withIos.ts`)

- **Verifies `react-native-tcp-socket` is installed** so its CocoaPods pod is autolinked during `pod install`.
- **Emits a non-fatal warning** (via Expo's `WarningAggregator`) if the module is missing — iOS does not throw, because a consumer could plausibly link it manually.

---

## Verify the installation

1. Confirm the native module is linked. On Android, the autolinked module appears in `android/app/build/generated/autolinking/…`; on iOS, `react-native-tcp-socket` appears in `ios/Podfile.lock` after `pod install`.
2. Run a minimal connect test:

```typescript
import { RouterOSAPI, RosException } from 'react-native-routeros';

async function verify() {
  const api = new RouterOSAPI({
    host: '192.168.88.1',
    user: 'admin',       // placeholder — use env vars / secure key store
    password: 'password',// placeholder — use env vars / secure key store
  });

  try {
    // connect() rejects with a RosException (e.g. CANTLOGIN, SOCKTMOUT, ECONNREFUSED)
    await api.connect();
  } catch (err) {
    if (err instanceof RosException) {
      console.error('RouterOS error:', err.errno, err.message);
    } else {
      console.error('Unexpected error:', err);
    }
    return;
  }

  // A command !trap rejects with a plain Error (its .message is the trap text).
  try {
    const resources = await api.write('/system/resource/print');
    console.log('Connected. Resources:', resources);
  } catch (err) {
    console.error('Command failed:', (err as Error).message);
  }

  await api.close();
}

verify();
```

If `connect()` resolves and `/system/resource/print` returns data, the native module is linked and the RouterOS API service is reachable.

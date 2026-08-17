# react-native-routeros

A React Native port of [node-routeros](https://github.com/aluisiora/node-routeros) that talks to MikroTik RouterOS devices over the RouterOS API protocol (raw TCP), with the same developer experience as `node-routeros` — no Node.js runtime required.

A React Native app can `connect` to a MikroTik router, log in (RouterOS v6/v7), and issue `write`, `writeStream`, and `stream` commands with the same API shape as `node-routeros` v1.6.8. The library targets both Bare React Native and Expo (custom dev clients via a config plugin and prebuild).

## Installation

```bash
npm install react-native-routeros
```

The library requires three peer dependencies, which must be present in your project. Install them explicitly:

```bash
npm install react react-native react-native-tcp-socket
```

`react-native-tcp-socket` is the native socket module that provides raw TCP + TLS transport. It autolinks on React Native 0.60+, but you must install it yourself because it is not bundled with React Native.

On iOS, after adding a native module, run:

```bash
cd ios && pod install && cd ..
```

## Peer Dependencies

The library declares its `peerDependencies` in `package.json` as follows:

| Package | Version | Role |
|---------|---------|------|
| `react` | `*` | Peer — required by the React Native runtime |
| `react-native` | `*` | Peer — required by the React Native runtime |
| `react-native-tcp-socket` | `^6.4.2` | Peer — the native TCP/TLS transport; must be autolinked |

`react-native-tcp-socket` is the native transport that must be autolinked for the library to open raw TCP connections to a RouterOS device. It is the only dependency that requires native code; every other dependency is pure JavaScript.

## Expo Config Plugin

The library ships an Expo config plugin for Continuous Native Generation (CNG) projects. Add it to the `plugins` array in your `app.json`:

```json
{
  "expo": {
    "plugins": ["react-native-routeros"]
  }
}
```

Then regenerate the native project:

```bash
npx expo prebuild
```

The plugin auto-links `react-native-tcp-socket` and applies the Android `INTERNET` permission and `usesCleartextTraffic` setting required for plain-TCP access (port 8728). If you connect over TLS (port 8729), cleartext traffic is not required.

## Expo Go is not supported

**Expo Go is NOT supported and cannot be used with this library.**

`react-native-routeros` requires the `react-native-tcp-socket` native module to open raw TCP sockets. Expo Go does not bundle this native module and cannot load arbitrary native code. You must use a custom dev client, which you create by running `npx expo prebuild` followed by `npx expo run:ios` / `npx expo run:android`, or by building through EAS Build.

Do not attempt to run this library inside Expo Go — the connection will fail because the native TCP module is unavailable.

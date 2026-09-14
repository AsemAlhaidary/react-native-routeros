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

## Usage

Import the public API from `react-native-routeros`:

```typescript
import {
  RouterOSAPI,
  RStream,
  RosException,
  RosTrapException,
  RosCommand,
  RosErrno,
} from 'react-native-routeros';
```

### Connect and login

Construct a `RouterOSAPI` with connection options and call `connect()`. Login is performed automatically inside `connect()` using the RouterOS MD5 challenge-response flow (RouterOS v6/v7), so there is no separate public login method — the connect call is the login call.

`connect()` resolves to the `RouterOSAPI` instance on success and rejects with a `RosException` on failure.

```typescript
import { RouterOSAPI, RosException } from 'react-native-routeros';

const api = new RouterOSAPI({
  host: '192.168.88.1',
  user: 'admin',
  password: 'password',
  timeout: 10,
});

async function main() {
  try {
    await api.connect();
    console.log('Connected and logged in');
  } catch (err) {
    if (err instanceof RosException) {
      console.error('Login failed:', err.errno, err.message);
    } else {
      console.error('Connection error:', err);
    }
  }
}
```

> Never hardcode real credentials in production code. Use environment variables or a secure key store.

### write

`write()` sends a one-shot command and resolves to an array of parsed response objects on `!done`. On a RouterOS `!trap`, it rejects with a plain `Error` (its `.message` is the trap text) — not a `RosException`.

```typescript
try {
  const addresses = await api.write('/ip/address/print');
  for (const address of addresses) {
    console.log(address.address, address.interface);
  }
} catch (err) {
  console.error('Write failed:', err);
}
```

You can also pass command parameters as an array:

```typescript
const ether = await api.write('/interface/print', ['=type=ether']);
```

### writeCommand

`writeCommand()` is the higher-level command API. It resolves to a `WriteResult`
(`{ records, ret?, tag }`) instead of a bare array — `ret` is the `!done =ret=`
value (the created object's `.id` on add flows), which `write()` intentionally
drops for node-routeros parity. It also supports a per-command timeout and
abort:

```typescript
const { records, ret, tag } = await api.writeCommand(
  '/ip/hotspot/user/add',
  ['=name=wasl', '=password=secret'],
  { timeoutMs: 5000 }
);
console.log('created .id:', ret);

// Abort via AbortSignal
const controller = new AbortController();
const p = api.writeCommand('/ip/hotspot/user/print', [], {
  signal: controller.signal,
});
controller.abort();
```

A `!trap` rejects with `RosTrapException`, whose `trapAttributes` carry the
router's structured trap fields verbatim (`category`, `message`, `place`,
`detail`) — so idempotent deletes can treat `category === 0` as "already gone":

```typescript
try {
  await api.writeCommand('/user/remove', ['=.id=*1']);
} catch (err) {
  if (err instanceof RosTrapException && err.trapAttributes.category === '0') {
    // already deleted — success
  }
}
```

### RosCommand (word builder)

`RosCommand` builds the command word array from friendly options — camelCase
keys become kebab-case, booleans become `yes`/`no`, `undefined` values are
skipped, and `''` values are skipped unless `preserveEmptyValues` is set. It
never emits `.tag=` (the channel owns that) and never appends the terminator.

```typescript
const cmd = new RosCommand('/ip/hotspot/user/add', {
  attributes: { limitUptime: '1h', disabled: true },
  preserveEmptyValues: true,
  queries: [{ field: 'name', operator: '=', value: 'wasl' }],
});
await api.writeCommand(cmd.path, cmd.toWords().slice(1));
```

### writeStream

`writeStream()` returns an `RStream` that emits `data` (each sentence), `done`, `trap`, and `close` events.

```typescript
const stream: RStream = api.writeStream('/interface/print', ['=type=ether']);

stream.on('data', (packet) => {
  console.log('Interface:', packet.name, packet.type);
});
stream.on('done', () => {
  console.log('Stream finished');
});
stream.on('trap', (data) => {
  console.error('Stream trap:', data.message);
});
stream.on('close', () => {
  console.log('Stream closed');
});
```

### stream

`stream()` is for continuous endpoints that keep sending data, such as `/tool/torch`. It returns an `RStream` (with empty-data debouncing enabled) and also accepts an optional callback as the last argument.

```typescript
const torch = api.stream('/tool/torch', ['=interface=ether1']);

torch.on('data', (packet) => {
  console.log('Torch packet:', packet);
});
```

Optional callback form:

```typescript
api.stream('/tool/torch', ['=interface=ether1'], (err, packet, stream) => {
  if (err) {
    console.error('Torch error:', err.message);
    return;
  }
  console.log('Torch packet:', packet);
});
```

The returned `RStream` supports `pause()`, `resume()`, and `stop()`:

```typescript
await torch.pause();
// ... later ...
await torch.resume();
// ... when finished ...
await torch.stop();
```

### keepalive

`keepaliveBy()` runs a command at a fixed interval to keep the session alive.

```typescript
api.keepaliveBy('#');
```

You can also enable keepalive automatically on connect by setting `keepalive: true` in the constructor options:

```typescript
const api = new RouterOSAPI({
  host: '192.168.88.1',
  user: 'admin',
  password: 'password',
  keepalive: true,
});
```

### close

`close()` gracefully closes the connection. The instance can be reconnected afterward via `setOptions()` then `connect()`.

`close()` is **idempotent** — concurrent or repeated calls share the in-flight
close and never reject with `ALRDYCLOSNG`. Calling `close()` while `connect()`
is still in flight aborts the handshake: `connect()` rejects with
`RosException('CANCELLED')` and always settles (it never hangs).

```typescript
await api.close();

// Reconnect later with new credentials
api.setOptions({
  host: '192.168.88.1',
  user: 'admin',
  password: 'new-password',
});
await api.connect();
```

### Connection state

`api.connected` and `api.connecting` expose socket-level truth on every
lifecycle path — false before `connect()`, true after login, false after
`close()` and after an unexpected drop:

```typescript
if (api.connected) {
  await api.writeCommand('/system/identity/print');
}
```

### Lifecycle events

`RouterOSAPI` extends `EventEmitter` and emits lifecycle events for reconnection awareness:

| Event | Payload | Fired when |
|-------|---------|------------|
| `close` | — | Connection closed (consumer-facing; enables reconnection). Also fired when `close()` aborts an in-flight `connect()` |
| `error` | `Error` | Connection-level error (socket error, timeout) |
| `fatal` | — | Protocol-level `!fatal` from the router — connection terminated |

```typescript
api.on('close', () => {
  console.log('Connection closed');
});
api.on('error', (err) => {
  console.error('Connection error:', err);
});
api.on('fatal', () => {
  console.error('Protocol fatal error — connection terminated');
});
```

Writes after the connection is closed/dropped reject with
`RosException('NOTCONNECTED')` (via `RosErrno.NOTCONNECTED`) — never an untyped
`TypeError` and never a pending promise.

### TLS

The RouterOS API defaults to plain TCP on port 8728, which is cleartext. For access outside a trusted local network, use TLS on port 8729:

```typescript
const api = new RouterOSAPI({
  host: 'router.example.com',
  user: 'admin',
  password: 'password',
  port: 8729, // required — TLS does not auto-select the port
  tls: {}, // enables TLS
});

// To trust a self-signed CA (RouterOS default), provide the PEM content:
const apiTls = new RouterOSAPI({
  host: 'router.example.com',
  user: 'admin',
  password: 'password',
  port: 8729,
  tls: { ca: /* PEM certificate content */ },
});
```

## Documentation

Deeper guides and examples:

- [Installation](docs/INSTALLATION.md) — end-to-end install for Bare React Native and Expo custom dev client (prerequisites, peer deps, `pod install`, config plugin, Expo Go limitation, verification)
- [API reference](docs/API.md) — complete reference for every public export (types, `RouterOSAPI`, `RStream`, lower-level classes, errors, codec/utils, transport)
- [Examples](docs/EXAMPLES.md) — real-world scenario recipes (connect + errors, read/write commands, monitoring + torch streams, pause/resume/stop, concurrent commands, keepalive, reconnection, TLS)
- [basic-usage.ts](examples/basic-usage.ts) — canonical end-to-end `connect → login → write → close` example
- [routeros-v6-usermanager.ts](examples/routeros-v6-usermanager.ts) — create RouterOS v6 user-manager users and activate them with a profile (bulk create + batch activation)

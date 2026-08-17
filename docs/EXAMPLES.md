# react-native-routeros — Examples

Real-world scenario recipes for `react-native-routeros`, grounded in the shipped public API. Every method call below matches the signature in `src/RouterOSAPI.ts` and `src/RStream.ts`, and every example follows the import/connect pattern established by the canonical [`examples/basic-usage.ts`](../examples/basic-usage.ts) example.

> **Credentials:** The `user`/`password` values in these examples are placeholders. In a real app, load credentials from environment variables or a secure key store — never hardcode real credentials.

The public API surface used here:

```typescript
import { RouterOSAPI, RStream, RosException, messages } from 'react-native-routeros';
```

- `RouterOSAPI` — connect / login (internal) / write / writeStream / stream / keepaliveBy / close / setOptions
- `RStream` — streaming result type (events `data`, `done`, `trap`, `close`, `error`)
- `RosException` — RouterOS error type (`errno`, `message`, `name === 'RosException'`)
- `messages` — the errno → human-readable message catalog

---

## 1. Connect and handle errors

`connect()` opens the TCP/TLS connection and performs the RouterOS MD5 challenge-response login **internally** (RouterOS v6/v7). There is no separate public login method — the connect call is the login call. It resolves to the instance on success and rejects with a `RosException` on failure.

```typescript
import { RouterOSAPI, RosException } from 'react-native-routeros';

const api = new RouterOSAPI({
  host: '192.168.88.1',
  user: 'admin',       // placeholder — use env vars / secure key store
  password: 'password',// placeholder — use env vars / secure key store
  timeout: 10,
});

try {
  await api.connect();
  console.log('Connected and logged in');
} catch (err) {
  if (err instanceof RosException) {
    // err.errno is the errno key (e.g. 'CANTLOGIN', 'SOCKTMOUT', 'ECONNREFUSED')
    console.error('Login failed:', err.errno, err.message);
  } else {
    console.error('Unexpected error:', err);
  }
}
```

---

## 2. Read resources

`write()` sends a one-shot command and resolves to an array of parsed response objects (each a `Record<string, any>` keyed by RouterOS field name) on `!done`.

```typescript
// List all IP addresses
const addresses = await api.write('/ip/address/print');
for (const addr of addresses) {
  console.log(addr.address, addr.interface);
}

// Filter interfaces by type (command parameters passed as an array)
const ether = await api.write('/interface/print', ['=type=ether']);
for (const iface of ether) {
  console.log(iface.name, iface.type);
}

// System resource snapshot
const resources = await api.write('/system/resource/print');
console.log(resources);
```

---

## 3. Write configuration

`write()` is also how you change configuration — the same RouterOS CLI path, with `=key=value` parameters.

```typescript
// Add a firewall filter rule: drop input on the input chain, tagged "block"
await api.write('/ip/firewall/filter/add', [
  '=chain=input',
  '=action=drop',
  '=comment=block',
]);
console.log('Firewall rule added');
```

> Firewall changes are destructive if written against a production router. Always test against a lab device first.

---

## 4. Continuous monitoring stream

`stream()` returns an `RStream` for endpoints that keep sending data, such as `/ip/address/listen`. Attach an `on('data')` listener to react to each packet.

```typescript
import { RouterOSAPI, RStream } from 'react-native-routeros';

await api.connect();

const listen: RStream = api.stream('/ip/address/listen');

listen.on('data', (packet) => {
  // Fires for every address change on the router
  console.log('Address update:', packet);
});
listen.on('error', (data) => {
  console.error('Stream error:', data.message);
});

// ... later, when you're done listening:
await listen.stop();
```

---

## 5. Torch stream (callback form)

`stream()` also accepts an optional `(err, packet, stream)` callback as the last argument — the exact three-argument shape declared by `RStream`.

```typescript
api.stream('/tool/torch', ['=interface=ether1'], (err, packet, stream) => {
  if (err) {
    console.error('Torch error:', err.message);
    return;
  }
  console.log('Torch packet:', packet);
});
```

`err` is `null` on a normal packet; the third argument is the `RStream` instance itself.

---

## 6. Stream lifecycle — pause, resume, stop

`RStream` exposes `pause()`, `resume()`, and `stop()` — each returns a `Promise<void>`.

```typescript
const listen = api.stream('/ip/address/listen');
listen.on('data', (packet) => console.log('Address update:', packet));

// Pause the stream (sends /cancel; the channel stays open for resume)
await listen.pause();

// ... do something else ...

// Resume on the same channel
await listen.resume();

// Stop entirely (cannot re-stream a directly-stopped stream)
await listen.stop();
```

---

## 7. Concurrent commands

Each `write()` call opens an independent tagged channel, so you can issue several commands in flight and await them together.

```typescript
const [addresses, interfaces, resources] = await Promise.all([
  api.write('/ip/address/print'),
  api.write('/interface/print'),
  api.write('/system/resource/print'),
]);

console.log('Addresses:', addresses);
console.log('Interfaces:', interfaces);
console.log('Resources:', resources);
```

---

## 8. Keepalive

`keepaliveBy()` runs a command at a fixed interval (every `timeout / 2` seconds) to keep the RouterOS session from timing out. You can also enable it automatically on connect.

```typescript
// Manual keepalive — run the no-op '#' command on an interval
api.keepaliveBy('#');

// Or enable keepalive automatically on connect via the constructor option
const autoKeepalive = new RouterOSAPI({
  host: '192.168.88.1',
  user: 'admin',
  password: 'password',
  keepalive: true, // runs keepaliveBy('#') right after login
});
await autoKeepalive.connect();
```

---

## 9. Reconnection

`RouterOSAPI` emits `close`, `fatal`, and `error` lifecycle events. To reconnect after a drop, listen for `close`, then call `setOptions(...)` followed by `connect()`.

```typescript
function createApi() {
  return new RouterOSAPI({
    host: '192.168.88.1',
    user: 'admin',
    password: 'password',
  });
}

let api = createApi();

api.on('close', async () => {
  console.log('Connection closed — reconnecting');
  try {
    // Re-apply options, then reconnect (connect() re-runs the internal login)
    api.setOptions({
      host: '192.168.88.1',
      user: 'admin',
      password: 'password',
    });
    await api.connect();
    console.log('Reconnected');
  } catch (err) {
    console.error('Reconnect failed:', err);
  }
});
api.on('fatal', () => {
  // Protocol-level !fatal — connection terminated by the router
  console.error('Protocol fatal error');
});
api.on('error', (err) => {
  console.error('Connection error:', err);
});

await api.connect();
```

---

## 10. React Native lifecycle

The library subscribes to React Native's `AppState` **internally** to verify its own internal consistency across app background/foreground transitions. There is no library-level auto-reconnect — **you** own the reconnection decision via the `close` event (see the reconnection example above). Backgrounding the app does not tear down the socket, and no action is required in your component code for lifecycle handling.

---

## 11. TLS

The RouterOS API defaults to plain TCP on port 8728, which is cleartext. For access outside a trusted local network, use TLS on port 8729.

```typescript
// Enable TLS with defaults — port auto-selects 8729 when no port is given
const tlsApi = new RouterOSAPI({
  host: 'router.example.com',
  user: 'admin',
  password: 'password',
  tls: {}, // enables TLS
});
await tlsApi.connect();

// Trust a self-signed CA (RouterOS default) by supplying the PEM content.
// The PEM is supplied by the consumer (e.g. bundled via require() in Metro),
// NOT a Node file path.
const pinnedApi = new RouterOSAPI({
  host: 'router.example.com',
  user: 'admin',
  password: 'password',
  port: 8729,
  tls: { ca: /* PEM certificate content as a string */ },
});
await pinnedApi.connect();
```

> **Never disable certificate validation.** To trust the RouterOS self-signed CA, pin it via `tls: { ca }`.

---

## 12. Error handling — look up errno against the catalog

`RosException` exposes a readonly `errno` key. You can map it to a human-readable message with the `messages` catalog.

```typescript
import { messages, RosException } from 'react-native-routeros';

try {
  await api.write('/ip/address/print');
} catch (err) {
  if (err instanceof RosException) {
    const friendly = messages[err.errno] ?? err.message;
    console.error(`RouterOS error (${err.errno}): ${friendly}`);
  } else {
    console.error('Unexpected error:', err);
  }
}
```

Common errno keys include `CANTLOGIN` ("Username or password is invalid"), `SOCKTMOUT` ("Timed out after {{seconds}} seconds"), and `STREAMCLOSD` ("Streaming is closed"). The full catalog is documented in [`docs/API.md`](API.md).

---

## writeStream (finite streaming result set)

`writeStream()` returns an `RStream` that emits each sentence as it arrives (plus `done`, `trap`, and `close`) for a finite result set.

```typescript
import { RStream } from 'react-native-routeros';

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

---

## Full program

```typescript
import { RouterOSAPI, RosException } from 'react-native-routeros';

async function run() {
  const api = new RouterOSAPI({
    host: '192.168.88.1',
    user: 'admin',      // placeholder — use env vars / secure key store
    password: 'password',// placeholder — use env vars / secure key store
    timeout: 10,
  });

  try {
    await api.connect();

    const addresses = await api.write('/ip/address/print');
    console.log('Addresses:', addresses);

    await api.close();
  } catch (err) {
    if (err instanceof RosException) {
      console.error('RouterOS error:', err.errno, err.message);
    } else {
      console.error('Unexpected error:', err);
    }
  }
}

export default run;
```

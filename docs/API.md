# react-native-routeros — API Reference

Complete reference for every public export of `react-native-routeros`. Every name, field list, method signature, and event name below is copied from the library source (`src/index.ts` and the files it re-exports) — no invented API surface.

The library is a React Native port of [`node-routeros`](https://github.com/aluisiora/node-routeros) v1.6.8. It talks to MikroTik RouterOS devices over the RouterOS API protocol (raw TCP). A React Native app can `connect` to a router, log in (RouterOS v6/v7), and issue `write`, `writeStream`, and `stream` commands — no Node.js runtime required.

---

## Public exports at a glance

Everything exported from the package root (`src/index.ts`):

| Export | Kind | Source |
|--------|------|--------|
| `RouterOSAPI` | class | `RouterOSAPI.ts` |
| `RStream` | class | `RStream.ts` |
| `Channel` | class | `Channel.ts` |
| `Connector` | class | `Connector.ts` |
| `Transmitter` | class | `Transmitter.ts` |
| `Receiver` | class | `Receiver.ts` |
| `RosException` | class | `RosException.ts` |
| `messages` | object (default export) | `messages.ts` |
| `decodeWin1252` | function | `win1252.ts` |
| `encodeWin1252` | function | `win1252.ts` |
| `md5Hash` | function | `md5.ts` |
| `debounce` | function | `utils.ts` |
| `createPlainSocket` | function | `transport/SocketAdapter.ts` |
| `createTlsSocket` | function | `transport/SocketAdapter.ts` |
| `IRosOptions` | interface (type) | `types.ts` |
| `TlsRnOptions` | interface (type) | `types.ts` |
| `IRosGenericResponse` | interface (type) | `types.ts` |
| `ConnectorOptions` | interface (type) | `Connector.ts` |
| `RosSocket` | type | `transport/SocketAdapter.ts` |
| `CreateSocketOptions` | interface (type) | `transport/SocketAdapter.ts` |

---

## 1. Types

### `IRosOptions`

Connection options passed to the `RouterOSAPI` constructor and `setOptions()`.

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `host` | `string` | **yes** | — | RouterOS device hostname or IP address |
| `user` | `string` | no | `''` | Login username |
| `password` | `string` | no | `''` | Login password |
| `port` | `number` | no | `8728` | API port. TLS does **not** auto-select 8729 — pass `port: 8729` explicitly when using TLS |
| `timeout` | `number` | no | `10` | Socket/command timeout in seconds |
| `tls` | `TlsRnOptions` | no | `undefined` | Presence enables TLS; pass options to pin certificates |
| `keepalive` | `boolean` | no | `false` | When `true`, automatically runs `keepaliveBy('#')` after connect |

### `TlsRnOptions`

RN-adapted TLS options (mirrors the `react-native-tcp-socket` TLS API, not Node's `tls.TlsOptions`).

| Field | Type | Description |
|-------|------|-------------|
| `ca` | `string \| string[]` | PEM-encoded CA certificate(s) to trust (e.g. the RouterOS self-signed CA) |
| `key` | `string` | PEM-encoded client private key |
| `cert` | `string` | PEM-encoded client certificate |
| `certAlias` | `string` | Android keystore alias for the client certificate |
| `keyAlias` | `string` | Android keystore alias for the client private key |

### `IRosGenericResponse`

Generic RouterOS API response shape — an index-signature object keyed by RouterOS field name.

```typescript
interface IRosGenericResponse {
  [propName: string]: any;
}
```

### `ConnectorOptions`

Options for the lower-level `Connector` class.

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `host` | `string` | **yes** | — | RouterOS hostname or IP |
| `port` | `number` | no | `8728` | API port |
| `timeout` | `number` | no | `10` | Timeout in seconds |
| `tls` | `boolean \| TlsRnOptions` | no | `undefined` | `true` enables TLS with defaults (port stays 8728); object form enables TLS with options and selects port 8729 only when `port` is omitted |

### `CreateSocketOptions`

Options for `createPlainSocket` / `createTlsSocket`.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `host` | `string` | **yes** | Hostname or IP |
| `port` | `number` | **yes** | TCP/TLS port |
| `timeout` | `number` | **yes** | Timeout in seconds (converted to ms internally) |
| `tls` | `TlsRnOptions` | no | `undefined` = plain TCP |

### `RosSocket`

Type alias for the normalized socket returned by `react-native-tcp-socket` (`TcpSockets.Socket`). Both plain TCP and TLS sockets satisfy this interface.

---

## 2. `RouterOSAPI`

`class RouterOSAPI extends EventEmitter` — the main public entry point for connecting to and communicating with a RouterOS device.

### Constructor

```typescript
new RouterOSAPI(options: IRosOptions)
```

### Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `setOptions` | `(options: IRosOptions): void` | Set/replace connection options; can be called before `connect()` or before reconnecting |
| `connect` | `(): Promise<this>` | Open the TCP/TLS connection and **log in automatically** (MD5 challenge-response, RouterOS v6/v7). Resolves to the instance on success, rejects with a `RosException` on failure. There is no separate public login method — `connect()` is the login call |
| `close` | `(): Promise<this>` | Gracefully close the connection. The instance can be reconnected via `setOptions()` then `connect()` |
| `write` | `(params: string \| string[], ...moreParams: (string \| string[])[]): Promise<Record<string, any>[]>` | Send a one-shot command on a new tagged channel; resolves with the array of parsed response objects on `!done`, rejects on `!trap` |
| `writeStream` | `(params: string \| string[], ...moreParams: (string \| string[])[]): RStream` | Send a command and return an `RStream` emitting `data`/`done`/`trap`/`close` |
| `stream` | `(params: string \| string[] = [], ...moreParams: (string \| string[] \| callback)[]): RStream` | Return an `RStream` for continuous endpoints (e.g. `/tool/torch`); accepts an optional `(err, packet, stream)` callback as the last argument; empty-data debouncing is enabled |
| `keepaliveBy` | `(params: string \| string[] = '#', ...moreParams: (string \| string[] \| callback)[]): void` | Run a command at a fixed interval (every `timeout / 2` seconds) to keep the session alive |
| `openChannel` | `(): Channel` | Open a new tagged `Channel` (used internally by `write`) |

### Events

The instance emits these lifecycle events (inherited from `EventEmitter`):

| Event | Payload | Description |
|-------|---------|-------------|
| `close` | — | Connection closed (consumer-facing; enables reconnection logic) |
| `error` | `Error` | Connection-level error |
| `fatal` | — | Protocol-level `!fatal` from the router — connection terminated |

### Login

`connect()` performs login internally. Login is `private` — there is no public login method. The flow is MD5 challenge-response:

1. Send `/login` with name + password.
2. If the response is empty → credentials accepted (fast path).
3. If a challenge is returned → build `0x00 + password bytes + challenge bytes`, MD5-hash it, and send `/login` with the `=response=` digest.

Credentials traverse the socket; the challenge internals are handled entirely inside `connect()`.

---

## 3. `RStream`

`class RStream extends EventEmitter` — handles continuous data from endpoints that keep sending data endlessly (e.g. `/tool/torch`). Supports pause / resume / stop.

### Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `data` | `(callback: (err: Error \| null, packet?: any, stream?: RStream) => void): void` | Set/replace the data callback (if not provided via constructor) |
| `pause` | `(): Promise<void>` | Pause the stream (sends `/cancel`); the channel stays open for resume |
| `resume` | `(): Promise<void>` | Resume the paused stream on the same channel |
| `stop` | `(pausing: boolean = false): Promise<void>` | Stop the stream entirely (cannot re-stream after a direct stop) |
| `close` | `(): Promise<void>` | Alias for `stop()` |

### Events

| Event | Payload | Description |
|-------|---------|-------------|
| `data` | `Record<string, any>` | Each streamed packet/sentence |
| `done` | — | Channel finished sending data |
| `trap` | `Record<string, any>` | RouterOS `!trap` (error) received |
| `close` | — | Stream channel closed |
| `error` | `Record<string, any>` | Trap forwarded as an error (emitted when no callback is registered) |

> Empty-data debouncing is enabled when the stream is created via `RouterOSAPI.stream()` (not `writeStream()`).

---

## 4. Lower-level classes

These are exported for advanced use and are what `RouterOSAPI` builds on internally. Most consumers only need `RouterOSAPI` and `RStream`.

### `Channel`

`class Channel extends EventEmitter` — generates a unique tag ID for a command and manages its request/response lifecycle.

| Member | Signature | Description |
|--------|-----------|-------------|
| constructor | `(connector: Connector)` | Create a channel bound to a connector |
| `Id` (getter) | `get Id(): string` | The channel's unique tag ID |
| `Connector` (getter) | `get Connector(): Connector` | The parent connector |
| `write` | `(params: string[], isStream?: boolean, returnPromise?: boolean): Promise<Record<string, any>[]> \| void` | Write a command over this channel (appends `.tag=<id>`); resolves on `!done`, rejects on `!trap` |
| `close` | `(force?: boolean): void` | Close the channel and remove its tag reader from the connector |

### `Connector`

`class Connector extends EventEmitter` — owns the socket (via `SocketAdapter`), `Transmitter`, and `Receiver`; sends and receives data.

| Member | Signature | Description |
|--------|-----------|-------------|
| constructor | `(options: ConnectorOptions)` | Create a connector; handles plain-TCP vs TLS selection and default ports |
| `connect` | `(): this` | Establish the socket connection |
| `write` | `(data: string[]): this` | Write a sentence (array of RouterOS words) with a null terminator |
| `read` | `(tag: string, callback: (packet: string[]) => void): void` | Register a tag to receive parsed packet callbacks |
| `stopRead` | `(tag: string): void` | Unregister a tag |
| `close` | `(): void` | Gracefully close (sends FIN) |
| `destroy` | `(): void` | Force-destroy the socket and remove all listeners |

Events: `connected`, `close`, `error`, `timeout`.

### `Transmitter`

`class Transmitter` — encodes and transmits data over the socket to the router.

| Member | Signature | Description |
|--------|-----------|-------------|
| constructor | `(socket: RosSocket)` | Bind to a socket |
| `write` | `(data: string \| null): void` | Encode a word (win1252 + length prefix); `null` writes the sentence terminator; queues when socket is not writable |
| `runPool` | `(): void` | Flush queued frames (called after connection is established) |

### `Receiver`

`class Receiver` — parses RouterOS API sentences (`!done`, `!trap`, `!fatal`, `!re`, `!empty`) from socket data and routes responses to the correct tag.

| Member | Signature | Description |
|--------|-----------|-------------|
| constructor | `(socket: RosSocket)` | Bind to a socket |
| `read` | `(tag: string, callback: (packet: string[]) => void): void` | Register a tag callback |
| `stop` | `(tag: string): void` | Remove a tag |
| `processRawData` | `(data: Uint8Array): void` | Process raw bytes received from the socket |
| `decodeLength` | `(data: Uint8Array): [number, number]` | Decode a RouterOS word length; returns `[descriptorBytesConsumed, contentLength]` |

---

## 5. Errors

### `RosException`

`class RosException extends Error` — RouterOS error type. Maps errno codes to human-readable messages from the `messages` catalog.

| Member | Type | Description |
|--------|------|-------------|
| `errno` | `string` (readonly) | The errno key, e.g. `'CANTLOGIN'`, `'SOCKTMOUT'`, `'ECONNREFUSED'` |
| `message` | `string` | Human-readable message resolved from `messages` |
| `name` | `'RosException'` | Always the literal string `'RosException'` (minifier-safe) |

```typescript
constructor(errno: string, extras?: Record<string, string>)
```

The `extras` map replaces `{{key}}` placeholders in the catalog message.

### `messages`

`messages` (default export) — a `Record<string, string>` mapping errno keys to human-readable messages. Notable keys:

| Key | Message |
|-----|---------|
| `CANTLOGIN` | Username or password is invalid |
| `SOCKTMOUT` | Timed out after {{seconds}} seconds |
| `STREAMCLOSD` | Streaming is closed |
| `ALRDYSTREAMING` | Already streaming |
| `CANTWRTWHLSTRMG` | Cannot write over the same channel that is streaming |
| `ALRDYCLOSNG` | Connection already closing |
| `ALRDYCONNECTING` | Already connecting |
| `UNREGISTEREDTAG` | Received data on unregistered tag … |
| `UNKNOWNREPLY` | Tried to process unknown reply: {{reply}} |
| `REFNOTFND` | Item not found with the reference provided in {{key}} |

It also includes a full catalog of POSIX error codes (`ECONNREFUSED`, `ECONNRESET`, `ETIMEDOUT`, `EACCES`, …).

---

## 6. Encoding and utilities

| Export | Signature | Description |
|--------|-----------|-------------|
| `decodeWin1252` | `(bytes: Uint8Array): string` | Decode Windows-1252 bytes to a UTF-16 string (RouterOS protocol text encoding) |
| `encodeWin1252` | `(str: string): Uint8Array` | Encode a string to Windows-1252 bytes; unmappable characters become `0x3F` (`?`) |
| `md5Hash` | `(data: Uint8Array \| ArrayBuffer): string` | MD5 hash of a binary buffer; returns a lowercase 32-char hex string (used for the login challenge-response) |
| `debounce` | `(callback: (...args: any[]) => void, timeout?: number): { run: (...args: any[]) => void; cancel: () => void }` | Debounce helper returning `{ run, cancel }` |

---

## 7. Transport

| Export | Signature | Description |
|--------|-----------|-------------|
| `createPlainSocket` | `(options: CreateSocketOptions): RosSocket` | Create a plain TCP socket (default port 8728) |
| `createTlsSocket` | `(options: CreateSocketOptions): RosSocket` | Create a TLS socket (default port 8729) |

### TLS option mapping

`createTlsSocket` maps `TlsRnOptions` onto `react-native-tcp-socket` TLS options:

| `TlsRnOptions` field | RN-TCP option | Notes |
|----------------------|---------------|-------|
| `ca` | `ca` | PEM content as string(s) |
| `key` | `key` | PEM content as string |
| `cert` | `cert` | PEM content as string |
| `certAlias` | `certAlias` | Android keystore alias |
| `keyAlias` | `keyAlias` | Android keystore alias |

PEM files are provided as strings (e.g. `require('./cert.pem')` for Metro-bundled assets), not Node file paths. There is no `tlsClientError` event in RN-TCP — TLS errors surface as regular `error` events on the socket.

---

## Security notes

- **Plain TCP is cleartext.** The API defaults to plain TCP on port 8728. For access outside a trusted local network, use TLS on port 8729.
- **Pin the self-signed CA.** RouterOS ships a self-signed certificate by default. To trust it, pass the CA PEM content via `tls: { ca }` (`TlsRnOptions.ca`).
- **Never hardcode credentials.** Use environment variables or a secure key store for `user` / `password`.

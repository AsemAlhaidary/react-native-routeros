# Features Research — react-native-routeros

**Domain:** MikroTik RouterOS API client for React Native
**Researched:** 2026-08-10
**Reference Library:** node-routeros v1.6.8 (archived, MIT)
**Ecosystem:** No existing React Native RouterOS library — greenfield opportunity

## Table Stakes

These features must exist or users leave. They match the node-routeros public API exactly so existing node-routeros users can migrate by changing their import.

| # | Feature | node-routeros equivalent | Complexity | Notes |
|---|---------|-------------------------|------------|-------|
| 1 | **Constructor with options** — host, user, password, port, timeout, keepalive, tls | `new RouterOSAPI({ host, user, password, port?, timeout?, keepalive?, tls? })` | LOW | Literal object passing. Wrap `react-native-tcp-socket` connect options internally. |
| 2 | **`connect()` — TCP+TLS connection + login** | `conn.connect()` → Promise<RouterOSAPI> | HIGH | Most complex feature. Must: open raw TCP socket, send RouterOS API login, run MD5 challenge-response (v6+v7), parse `!done`/`!trap` from wire protocol. The MD5 hash must be pure-JS (no `crypto` module). TLS requires `react-native-tcp-socket`'s `connectTLS` with optional self-signed cert acceptance. |
| 3 | **`write(command, params?)` — one-shot command** | `conn.write('/ip/address/print', ['?.id=*1'])` → Promise<IRosGenericResponse[]> | MEDIUM | Create tagged Channel, send array of win1252-encoded strings, resolve on `!done`, reject on `!trap`. Must handle `!re` (intermediate response) sentences accumulating into response array. |
| 4 | **`writeStream(command, params?)` — streaming command with events** | `conn.writeStream(...)` → event emitter with `data`/`done`/`trap`/`close` | MEDIUM | Same wire protocol as `write()` but exposed via EventEmitter. Must implement Channel-to-event bridging. |
| 5 | **`stream(command, params?, callback)` — continuous data (RStream)** | `conn.stream(...)` → RStream with `pause()`/`resume()`/`stop()` | HIGH | Listens indefinitely for `/ip/address/listen`, `/tool/torch`, etc. Must handle debounce on empty data, pause/resume wire flow, and clean teardown on `stop()`. The callback signature `(error, packet, stream)` is part of the contract. |
| 6 | **`close()` — graceful disconnect** | `conn.close()` → Promise<void> | LOW | Close socket, cancel all active channels, clear keepalive timer. Must resolve after socket `close` event. Reusable — `connect()` can be called again. |
| 7 | **`keepaliveBy(command, callback?)` — idle prevention** | `conn.keepaliveBy('/system/resource/print')` | LOW | Set interval to run a command periodically. Disable default keepalive if `keepalive: false` in constructor. |
| 8 | **`setOptions(options)` — reconfigure without recreating** | `conn.setOptions({ host: '...' })` | LOW | Mutate stored config. Takes effect on next `connect()`. |
| 9 | **Connection events** — `error`, `close`, `timeout` | `conn.on('error', fn)` | LOW | RouterOSAPI extends EventEmitter. These are emitted from the underlying socket wrapper. |
| 10 | **RosException with errno-keyed messages** | `throw new RosException('CANTLOGIN')` | LOW | Map RouterOS `!trap` messages to human-readable strings. Must import from `messages.ts`. |
| 11 | **TypeScript types shipped** | `RouterOSAPIConfig`, `IRosGenericResponse`, `IStream` | MEDIUM | `.d.ts` files must be generated and included in the npm package. All public API must be typed. |
| 12 | **win1252 encoding of API sentences** | Transmitter encodes strings → win1252 byte arrays | MEDIUM | Pure-JS encoder (no `iconv-lite`). Must handle accented characters consistently with Winbox. ~128-line lookup table. |
| 13 | **Works on Bare React Native + Expo (custom dev client)** | N/A | LOW | Must not depend on Node.js built-ins. `react-native-tcp-socket` is the transport. |
| 14 | **README with usage examples** | N/A | LOW | Show connect → write → close, stream with pause/resume/stop, TLS config. Migration note from node-routeros. |
| 15 | **Channel: per-command tag, resolves/rejects** | `Channel` class internal | MEDIUM | Internal mechanism. Each `write()`/`writeStream()` creates a tagged Channel. Responses from the receiver are routed by tag. Must handle `cancel()`. |
| 16 | **Receiver: parse RouterOS wire protocol** | `Receiver` class internal | HIGH | Parse length-prefixed frames, extract sentences (`!done`, `!trap`, `!fatal`, `!re`, `!empty`), split attribute=value pairs. This is the protocol parser — getting it wrong silently breaks everything. |

## Differentiators

Features that set this library apart from alternatives and make it the obvious choice for React Native developers.

| # | Feature | Value Proposition | Complexity | Notes |
|---|---------|-------------------|------------|-------|
| D1 | **First-to-market RN RouterOS library** | No other library lets React Native apps talk directly to MikroTik routers. Users currently must run a Node.js proxy server or use REST API middleware. | — | Market differentiator by existence alone. |
| D2 | **Zero Node.js runtime dependency** | Works in pure React Native JS environment. No polyfills for `net`, `tls`, `crypto` — everything is either RN-native or pure-JS. | HIGH | This is the core engineering challenge. MD5, win1252, and TCP must all be RN-compatible. |
| D3 | **Identical API to node-routeros** | Existing node-routeros users (7.8k weekly downloads) can migrate React Native apps by changing the `import` line. Documentation and mental models transfer directly. | LOW | A deliberate design constraint that simplifies adoption. |
| D4 | **Expo config plugin** | Expo users get one-command setup: `npx expo install react-native-routeros` + plugin in `app.json`. No manual native linking. | MEDIUM | Requires an Expo config plugin (`withRouterOS`) that auto-links `react-native-tcp-socket` and sets minimum Android SDK to 21. |
| D5 | **TLS with self-signed cert support** | MikroTik routers ship with self-signed certs by default. This library makes that the happy path, not an obstacle. | MEDIUM | Leverages `react-native-tcp-socket`'s `ca` option. Must document the `.pem` cert workflow clearly. |
| D6 | **Pure-TypeScript from source** | Unlike the original node-routeros (which only ships compiled JS in `dist/`), this library has readable, documented TypeScript source that users can inspect, learn from, and contribute to. | LOW | Original repo is archived and `src/` is missing from npm. This fixes that. |

## Anti-Features

Features deliberately excluded — and why.

| # | Anti-Feature | Why Excluded |
|---|-------------|--------------|
| AF1 | **Expo Go compatibility** | Raw TCP requires `react-native-tcp-socket` native module. Expo Go runs pure JS only. Custom dev client required. Explicitly dropped per user decision. |
| AF2 | **RouterOS REST API transport** | RouterOS v7.1+ has a REST API on port 80/443. This is a separate protocol (JSON over HTTP), not the RouterOS API protocol (binary over TCP:8728). Building both would double the API surface. Users wanting REST can use `fetch()`. Focus stays on the API protocol. |
| AF3 | **RouterOS WebSocket transport** | RouterOS WebSocket is not the same as the API protocol. Explicitly out of scope per PROJECT.md. |
| AF4 | **High-level "routeros-client" abstraction** | The original author also built [`routeros-client`](https://github.com/aluisiora/routeros-client) — an OOP wrapper with resource objects (`.connect()`, `.get()`, `.add()`, `.remove()`). This is a separate concern. Building a low-level API client first is the right foundation; a high-level wrapper can be a separate package later. |
| AF5 | **SSH transport** | RouterOS supports SSH, but this is a different protocol. Mixing transport layers in one library creates API confusion and maintenance burden. |
| AF6 | **Bundled CA certificates** | Let users manage certs themselves. Bundling certs in the library creates a security maintenance burden and bloats the package. |
| AF7 | **GitHub/npm publishing in v1** | Deferred per user decision. Local-only development for this phase set. |
| AF8 | **React hooks API (`useRouterOS`)** | A hooks-based wrapper would be nice but is a different API surface. Building the core client first is more valuable. Hooks can be a separate package or later addition. |

## Feature Dependencies

```
┌──────────────────────────────────────────────────────────────┐
│  Layer 0: Foundation                                         │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ F13: react-native-tcp-socket (transport)                │ │
│  │ F12: win1252 encoder (pure-JS)                          │ │
│  │ MD5 (pure-JS, needed by connect)                        │ │
│  └─────────────────────────────────────────────────────────┘ │
├──────────────────────────────────────────────────────────────┤
│  Layer 1: Protocol                                           │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ F16: Receiver (wire protocol parser)                    │ │
│  │   → parses !done/!trap/!fatal/!re/!empty sentences     │ │
│  │   → depends on: F12 (win1252)                           │ │
│  └─────────────────────────────────────────────────────────┘ │
├──────────────────────────────────────────────────────────────┤
│  Layer 2: Core API                                           │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ F1:  Constructor + options                              │ │
│  │ F2:  connect() ─── depends on: F13, F16, MD5           │ │
│  │ F15: Channel ───── depends on: F16                      │ │
│  │ F6:  close() ───── depends on: F13                      │ │
│  │ F8:  setOptions()                                       │ │
│  │ F9:  Connection events                                  │ │
│  │ F10: RosException                                       │ │
│  └─────────────────────────────────────────────────────────┘ │
├──────────────────────────────────────────────────────────────┤
│  Layer 3: Commands + Streaming                               │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ F3:  write() ─────── depends on: F2, F15, F16          │ │
│  │ F4:  writeStream() ─ depends on: F2, F15, F16          │ │
│  │ F5:  stream() ────── depends on: F2, F15, F16          │ │
│  │ F7:  keepaliveBy() ─ depends on: F2, F3                │ │
│  └─────────────────────────────────────────────────────────┘ │
├──────────────────────────────────────────────────────────────┤
│  Layer 4: Developer Experience                               │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ F11: TypeScript types (.d.ts)                           │ │
│  │ F14: README with examples                               │ │
│  │ D4:  Expo config plugin                                 │ │
│  └─────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

### Phase Ordering Recommendation

**Must build in this order due to hard dependencies:**

1. **Layer 0** (win1252 encoder, MD5, transport integration) — everything else depends on protocol parsing and transport
2. **Layer 1** (Receiver/protocol parser) — needed for login handshake and all commands
3. **Layer 2** (Constructor, connect, Channel, close, events, RosException) — the connect/login flow must work before any command
4. **Layer 3** (write, writeStream, stream, keepaliveBy) — all commands depend on connect + Channel
5. **Layer 4** (Types, docs, Expo plugin) — can parallelize after Layer 3

## Sources

- node-routeros v1.6.8 compiled `dist/` — direct analysis of `RouterOSAPI.js`, `Channel.js`, `RStream.js`, `RosException.js`, `messages.js`, `utils.js`, connector files
- node-routeros GitHub README (archived, aluisiora/node-routeros) — feature list and usage examples
- node-routeros-v2 README (Jace254/node-routeros-v2, active fork) — same API surface, confirms continuity
- react-native-tcp-socket README (Rapsssito/react-native-tcp-socket, 393 stars) — TCP/TLS API surface compatible with Node's `net`/`tls`
- RouterOS API protocol documentation (MikroTik wiki) — wire protocol: length-prefixed frames, sentence types, MD5 challenge-response
- PROJECT.md — explicit requirements: full API parity, RN socket choice, out-of-scope items

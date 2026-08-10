# Architecture Research -- react-native-routeros

**Domain:** React Native library for MikroTik RouterOS API protocol (TCP)
**Researched:** 2026-08-10
**Source:** `node-routeros` v1.6.8 compiled `dist/` + `react-native-tcp-socket` v6.4.2 docs

---

## Original Architecture (node-routeros)

### Component Ownership Graph

```
RouterOSAPI (EventEmitter) -- main public API
  owns -> Connector (EventEmitter)
    owns -> socket (net.Socket | tls.TLSSocket)
    owns -> Transmitter (wraps socket for writing)
    owns -> Receiver (wraps socket for reading/parsing)
  creates -> Channel (EventEmitter) -- per-command, via openChannel()
    references -> Connector (for read/write)
  creates -> RStream (EventEmitter) -- continuous streaming
    owns -> Channel (from RouterOSAPI.openChannel())
```

### Component Responsibilities and Interactions

| Component | Responsibility | Depends On | Emits To |
|-----------|---------------|------------|----------|
| **RouterOSAPI** | Connection lifecycle, login (MD5 challenge-response), write/writeStream/stream, keepalive, channel bookkeeping, setOptions/close | Connector, Channel, RStream, RosException, crypto (MD5), timers | Consumer code (connected, error, close events) |
| **Connector** | Socket management (plain TCP vs TLS), connect()/close()/destroy(), delegates I/O to Transmitter/Receiver | net/tls, Transmitter, Receiver, RosException | RouterOSAPI (connected, error, timeout, close) |
| **Transmitter** | win1252 encoding via iconv-lite, RouterOS length-prefixed framing, write-pool for pre-connect buffering | iconv-lite, socket (writable) | None (inner component) |
| **Receiver** | Parses TCP stream into RouterOS sentences (!done/!trap/!fatal/!re), routes by .tag, win1252 decoding via iconv-lite | iconv-lite, socket (data events) | Channel callbacks (via tag Map) |
| **Channel** | Per-command tag generation (Math.random().toString(36)), registers reader on Connector, resolves/rejects on !done/!trap | Connector (read/write) | Consumer code (done, trap, data, close events) |
| **RStream** | Continuous streaming (listen/torch), pause/resume/stop, section buffering, empty-data debounce | Channel, utils (debounce), timers | Consumer code (data, done, trap, error, started, stopped events) |
| **RosException** | Error wrapper with errno-to-message lookup | messages | Thrown anywhere |
| **messages** | Static error message map (UNREGISTEREDTAG, CANTLOGIN, SOCKTMOUT, etc.) | None | RosException |
| **utils** | debounce() helper | None | RStream |
| **IRosOptions** | TS interface: {host, user?, password?, port?, timeout?, tls?, keepalive?} | tls types (Node) | RouterOSAPI constructor |
| **IRosGenericResponse** | { [propName: string]: any } generic response shape | None | Channel, RStream |

### Data Flow -- write Command

```
RouterOSAPI.write(params)
  -> openChannel() creates Channel(connector)
  -> Channel.write(params) appends .tag=<id>, calls connector.read(id, callback),
     then connector.write(params)
    -> Connector.write(data) iterates params -> transmitter.write(line) per line,
       then transmitter.write(null)
      -> Transmitter.encodeString(str) -> iconv.encode(str, 'win1252')
         -> length-prefix frame -> socket.write(buffer)
    -> [response arrives] socket 'data' event -> Connector.onData(data)
       -> receiver.processRawData(data)
      -> Receiver.processRawData -> decodeLength -> iconv.decode(chunk, 'win1252')
         -> sentencePipe -> processSentence()
        -> detect .tag= -> currentTag; detect !done/!trap/!re -> sendTagData(tag)
           -> tag callback(packet)
  -> Channel.processPacket -> !done resolves Promise, !trap rejects
```

### Data Flow -- stream Command

```
RouterOSAPI.stream(params, callback)
  -> openChannel() -> new RStream(channel, params, callback)
  -> RStream.start() -> channel.on('stream', ...) -> channel.write(params, isStream=true)
  -> [continuous !re responses] -> RStream.onStream(packet) -> callback(null, packet, stream)
  -> [section handling] -> debounce buffer .section packets -> callback per section group
  -> pause -> sends /cancel on new temporary Channel -> !done -> paused state
  -> resume -> channel.write(params, isStream=true) again
```

### Login Flow (MD5 Challenge-Response, RouterOS v6.43+)

```
connect() -> Connector 'connected' -> RouterOSAPI.login()
  -> write('/login', ['=name=user', '=password=pass'])
    -> [0 results] -> credentials accepted (6.43+ fast path)
    -> [1 result with challenge 'ret'] -> construct buffer (0x00 + password + challengeHex)
       -> MD5 hash -> write('/login', ['=name=user', '=response=00<md5hex>'])
      -> success -> connected
      -> failure -> CANTLOGIN
```



---

## RN Migration Map

### Abstraction Boundary

**Protocol core stays intact.** The RouterOS API sentence protocol (Receiver parsing, Transmitter framing, Channel tag management, RStream lifecycle, RouterOSAPI command orchestration) is transport-agnostic. Only three layers need replacement:

1. **Transport layer** -- `net`/`tls` sockets replaced by `react-native-tcp-socket`
2. **Crypto layer** -- `crypto.createHash('MD5')` replaced by pure-JS MD5 implementation
3. **Encoding layer** -- `iconv-lite` win1252 replaced by custom pure-JS codec

Everything else (Channel, RStream, RouterOSAPI business logic, RosException, messages, utils) ports with zero logical changes -- only TypeScript type adjustments.

### Component Replacement Table

| Component | Original Dep | RN Replacement | Impact | Risk |
|-----------|-------------|----------------|--------|------|
| **Connector** | `net.Socket` / `tls.connect()` | `react-native-tcp-socket` (`createConnection` / `connectTLS`) | Socket creation model differs: factory function instead of `new Socket()`, TLS is separate method, no `tlsClientError` event | MEDIUM |
| **Connector (plain)** | `new net.Socket()` then `socket.connect(port, host)` | `TcpSocket.createConnection({port, host, localAddress?, connectTimeout?}, callback)` | Same `write`, `destroy`, `end`, `setTimeout`, `setKeepAlive`, same events (`data`, `error`, `close`, `connect`, `timeout`) | LOW |
| **Connector (TLS)** | `tls.connect(port, host, options, callback)` | `TcpSocket.connectTLS({port, host, ca?, key?, cert?, ...}, callback)` | TLS opts use `require()` for certs vs Node's string paths; no `tlsClientError` event | MEDIUM |
| **RouterOSAPI.login()** | `crypto.createHash('MD5')` | Pure-JS MD5 (`ts-md5` or custom) | Same output, different API shape; MD5 is deterministic | LOW |
| **Receiver.processRawData()** | `iconv.decode(data, 'win1252')` | Custom `win1252.decode(buffer)` | Same input (Buffer/Uint8Array bytes) to same output (UTF-8 string); ~256-entry lookup table | LOW |
| **Transmitter.encodeString()** | `iconv.encode(str, 'win1252')` | Custom `win1252.encode(string)` | Same UTF-8 string input to same byte output; ~27 special cases | LOW |
| **Receiver** | `socket: Socket` (Node `net`) | `socket: TcpSocket` (RN-TCP) | Type-only change; `socket.emit('fatal')` is custom event, works on any EventEmitter | LOW |
| **Transmitter** | `socket: Socket` (Node `net`) | `socket: TcpSocket` (RN-TCP) | Type-only; `socket.writable` and `socket.write()` are identical APIs | LOW |
| **IRosOptions** | `tls?: TlsOptions` (Node) | `tls?: TlsRnOptions` (custom) | RN-TCP TLS: no `rejectUnauthorized`, has `ca` as `require()`, `certAlias`/`keyAlias` | LOW |
| **RouterOSAPI** | `import { clearTimeout } from 'timers'` | Global `clearTimeout` | RN has global timers; just drop the import | LOW |
| **RosException** | `Error.captureStackTrace` | Guard with `if (Error.captureStackTrace)` | V8-only API; JSC/Hermes may lack it; conditional guard is safe | LOW |
| **all** | `require('debug')` | Same (works in RN) | `debug` package functions in RN environments | LOW |
| **all** | `require('events').EventEmitter` | Same (works in RN) | RN has EventEmitter polyfill or use `eventemitter3` for reliability | LOW |

### win1252 Codec Detail

Windows-1252 is Latin-1 (ISO 8859-1) with printable characters mapped to bytes 0x80-0x9F (which are control codes in Latin-1).

**Decode** (bytes to string):
- 0x00-0x7F: direct mapping (ASCII)
- 0x80-0x9F: lookup table (27 special characters incl. Euro sign, smart quotes, dashes)
- 0xA0-0xFF: direct mapping (Latin-1 supplement, identical to Unicode)

**Encode** (string to bytes):
- Reverse of decode; most characters 0x00-0xFF are direct, 27 special characters require lookup

**Size:** ~50 lines of TypeScript. No external dependency. This is the same codec `iconv-lite` uses internally for win1252.

### MD5 Implementation (Login Only)

The login challenge hash needs `md5.update(buffer).digest('hex')`. Options:

| Library | Size | Deps | API |
|---------|------|------|-----|
| `ts-md5` | ~3KB | None | `Md5.hashStr(str)` or `new Md5().appendByteArray(arr).end()` |
| `js-md5` | ~4KB | None | `md5(string)` or `md5(arrayBuffer)` |
| `spark-md5` | ~7KB | None | `SparkMD5.ArrayBuffer.hash(arr)` |
| Custom inline | ~1KB | None | Direct MD5 on small fixed-size input |

**Recommendation:** `ts-md5` -- smallest, zero deps, TypeScript-native, well-maintained. Alternatively, inline MD5 since the challenge input is always under 128 bytes (16-byte challenge + password + null byte).



---

## react-native-tcp-socket vs Node net.Socket -- API Comparison

### What is Identical

- `socket.write(data)` -- same signature
- `socket.destroy()` -- same
- `socket.end()` -- same
- `socket.setTimeout(ms)` -- same
- `socket.setKeepAlive(enable)` -- same (initialDelay is ignored on RN)
- `socket.on('data', callback)` -- same (Buffer objects)
- `socket.on('error', callback)` -- same
- `socket.on('close', callback)` -- same
- `socket.on('timeout', callback)` -- same
- `socket.writable` -- same property

### What is Different

| Aspect | Node net.Socket | react-native-tcp-socket | Workaround |
|--------|----------------|-------------------------|------------|
| **Creation** | `new net.Socket()` then `socket.connect(port, host)` | `TcpSocket.createConnection({port, host}, callback)` | Wrap in factory; callback doubles as 'connect' event |
| **TLS creation** | `tls.connect(port, host, options, callback)` | `TcpSocket.connectTLS({port, host, ca, key, cert, ...}, callback)` | Separate method; TLS opts use `require()` for certs, not file paths |
| **connect event** | `socket.on('connect', cb)` -- can race if set after connect | Reliable via callback param + also emits 'connect' | Use callback for primary connect handler; listen to event as fallback |
| **tlsClientError** | Emitted by Node TLS socket on handshake failure | Not emitted | Map to 'error' event; already listened, so remove tlsClientError line |
| **fatal event** | Not a Node event at all (custom emit in Receiver) | Not a Node event at all (custom emit in Receiver) | No issue -- `socket.emit('fatal')` is custom code, works on any EventEmitter |
| **connectTimeout** | `socket.setTimeout()` can be set before connect | Has separate `connectTimeout` option in ms | Use `connectTimeout` for connection timeout; `setTimeout` for idle timeout |
| **localAddress** | Optional param to `connect()` | Option in createConnection object | Already in options object |
| **Certs (TLS)** | Strings or file paths | `require('cert.pem')` -- Metro-bundled assets | Consumer calls `require()`; library passes through transparently |

### Connector Rewrite Strategy

The RN Connector wraps socket creation behind two thin factory methods:

```typescript
// Plain TCP
private createPlainSocket(): TcpSocket {
    const socket = TcpSocket.createConnection(
        { port: this.port, host: this.host },
        () => this.onConnect()  // connect callback
    );
    socket.on('data', (data) => this.onData(data));
    socket.on('error', (err) => this.onError(err));
    socket.on('close', () => this.onEnd());
    socket.setTimeout(this.timeout * 1000);
    socket.on('timeout', () => this.onTimeout());
    socket.setKeepAlive(true);
    return socket;
}

// TLS
private createTlsSocket(): TcpSocket {
    const socket = TcpSocket.connectTLS(
        { port: this.port, host: this.host, ...this.tlsOpts },
        () => this.onConnect()
    );
    // Same event wiring as plain, minus tlsClientError (not emitted in RN)
    socket.on('data', (data) => this.onData(data));
    socket.on('error', (err) => this.onError(err));
    socket.on('close', () => this.onEnd());
    socket.setTimeout(this.timeout * 1000);
    socket.on('timeout', () => this.onTimeout());
    socket.setKeepAlive(true);
    return socket;
}
```

**Key behavioral notes:**
- Original `connect()` created Receiver/Transmitter *before* connect was established. Same in RN -- create them after getting socket reference from factory.
- `transmitter.runPool()` is called from `onConnect` -- identical to original.
- **tlsClientError gap:** Remove the `socket.on('tlsClientError', ...)` line. RN-TCP surfaces TLS errors as regular 'error' events. Since 'error' is already listened, there is zero loss of error coverage.
- **socket.once('end', ...):** Keep as-is. RN-TCP supports 'end' via Stream inheritance.



---

## Component Boundaries and Data Flow (RN Version)

```
                    PUBLIC API SURFACE
 RouterOSAPI.connect() .write() .writeStream() .stream()
 .close() .setOptions()
 Events: connected, error, close
                         |
                         | owns
                    Connector (RN)
 +--------------------------------------------------+
 |  Socket creation (platform/ dir)                  |
 |  +--------------------+  +--------------------+  |
 |  | createPlainSocket() |  | createTlsSocket()   |  |
 |  | TcpSocket.create    |  | TcpSocket.connectTLS|  |
 |  | Connection(...)     |  | (...)               |  |
 |  +--------------------+  +--------------------+  |
 +--------------------------------------------------+
 owns: Transmitter, Receiver
       |                     |
  Transmitter            Receiver
  encodeString()          processRawData(data)
   +-- win1252.encode()    +-- decodeLength(data)
   +-- RouterOS            +-- win1252.decode()
       length-prefix       +-- processSentence()
  socket.write()               +-- sendTagData(tag)
                            tags: Map<string, callback>
                            socket.on('data', ...)

PROTOCOL CORE (unchanged from node-routeros):
  Channel      RStream      RosException
  .tag gen     pause/resume  errno->msg
  .write()     /stop         lookup
  .processPkt() section buf  messages map
  .parsePkt()  debounce

REPLACED LAYERS:
  Pure-JS MD5      win1252 codec
  (ts-md5 or       decode()
   inline)          encode()
                    ~50 LOC
```

### Abstraction Boundary -- What to Keep vs Replace

```
KEEP (port verbatim):            REPLACE (RN-specific):
 Receiver.js                      net -> react-native-tcp-socket
  +-- processRawData()            tls -> react-native-tcp-socket
  +-- processSentence()           crypto MD5 -> pure-JS MD5
  +-- decodeLength()              iconv-lite -> custom win1252
  +-- sendTagData()               timers import -> global
 Transmitter.js
  +-- encodeString() (logic)
  +-- runPool()
 Channel.js
 RStream.js
 RouterOSAPI.js (logic)
 RosException.js
 messages.js
 utils.js
 IRosGenericResponse.ts
```

---

## Build Order

The port is structured into 5 waves by dependency chain. Components in the same wave can be built in parallel.

### Wave 0 -- Foundation (zero dependencies, all parallel)

| # | Component | What It Is | Deps | Est. LOC |
|---|-----------|-----------|------|----------|
| 0.1 | `src/messages.ts` | Error message map (direct port of `messages.js`) | None | 135 |
| 0.2 | `src/RosException.ts` | Error class wrapping errno-to-message lookup | `messages` | 40 |
| 0.3 | `src/utils.ts` | `debounce()` helper function | None | 20 |
| 0.4 | `src/types.ts` | `IRosOptions`, `IRosGenericResponse` (RN-adapted) | None | 30 |
| 0.5 | `src/win1252.ts` | Pure-JS encode/decode for Windows-1252 codec | None | 60 |

**Parallelism:** 0.1-0.5 are fully independent. Build them all at once.

### Wave 1 -- Transport (depends on Wave 0)

| # | Component | What It Is | Deps | Est. LOC |
|---|-----------|-----------|------|----------|
| 1.1 | `src/transport/SocketAdapter.ts` | Thin wrapper: `createPlainSocket()` / `createTlsSocket()`, event wiring, TLS option normalization | `types`, `react-native-tcp-socket` | 80 |

### Wave 2 -- Protocol Core (depends on Waves 0-1)

| # | Component | What It Is | Deps | Est. LOC |
|---|-----------|-----------|------|----------|
| 2.1 | `src/Transmitter.ts` | Port of `Transmitter.js` -- uses `win1252.encode()` instead of `iconv.encode()` | `win1252` | 60 |
| 2.2 | `src/Receiver.ts` | Port of `Receiver.js` -- uses `win1252.decode()` instead of `iconv.decode()` | `win1252`, `RosException` | 250 |

**Parallelism:** 2.1 and 2.2 share `win1252` only (already built). Build in parallel.

### Wave 3 -- API Layer (depends on Waves 0-2)

| # | Component | What It Is | Deps | Est. LOC |
|---|-----------|-----------|------|----------|
| 3.1 | `src/Channel.ts` | Port of `Channel.js` -- per-command tag, Promise-based write | `RosException` + Connector interface | 110 |
| 3.2 | `src/Connector.ts` | Port of `Connector.js` -- uses SocketAdapter + Transmitter + Receiver | `SocketAdapter`, `Transmitter`, `Receiver`, `RosException` | 140 |
| 3.3 | `src/RStream.ts` | Port of `RStream.js` -- continuous streaming with pause/resume/stop | `Channel`, `RosException`, `utils` | 210 |
| 3.4 | `src/md5.ts` | Pure-JS MD5 wrapper for login challenge | None (or `ts-md5`) | 5 (wrapper) |

**Dependency chain:** `Connector` depends on `Transmitter` + `Receiver` (Wave 2). `Channel` only needs `Connector`'s interface (not implementation). `RStream` depends on `Channel`. Sequence: build `Channel` (interface-only) + `Connector` + `md5` in parallel, then `RStream`.

### Wave 4 -- Integration and Exports (depends on Wave 3)

| # | Component | What It Is | Deps | Est. LOC |
|---|-----------|-----------|------|----------|
| 4.1 | `src/RouterOSAPI.ts` | Port of `RouterOSAPI.js` -- login, write/writeStream/stream, keepalive, channel bookkeeping, close | `Connector`, `Channel`, `RStream`, `RosException`, `md5`, `types` | 300 |
| 4.2 | `src/index.ts` | Barrel exports (match original `index.js` export surface) | All components | 12 |

### Complete Dependency Graph

```
messages.ts ──┐
               ├──> RosException.ts ──┐
utils.ts ─────┘                      │
types.ts ─────────────────────┐      │
win1252.ts ──┐                 │      │
              ├──> Transmitter.ts ──┐ │
              └──> Receiver.ts ─────┤ │
SocketAdapter.ts ──────────────────┤ │
                                   ├─> Connector.ts ──┐
md5.ts ────────────────────────────┘                  │
Channel.ts ────> RStream.ts ──────────────────────────┤
                                                      ├─> RouterOSAPI.ts ──> index.ts
                                                      │
                                      RosException.ts ┘
                                      types.ts ────────┘
```

### Recommended Phase Structure

| Phase | Components | Rationale |
|-------|-----------|-----------|
| **Phase 1: Foundation + Protocol** | messages, RosException, utils, types, win1252, Transmitter, Receiver | Build the entire data pipeline first. Test with mock socket. |
| **Phase 2: Transport + API** | SocketAdapter, Connector, Channel, md5 | Wire real TCP socket. Test connect/login. |
| **Phase 3: Streaming + Integration** | RStream, RouterOSAPI, index.ts | Complete feature surface. Full parity tests. |
| **Phase 4: Build Config + Docs** | package.json, tsconfig, README, .gitignore | Prepare distributable. |

**Phase ordering rationale:**
- Phase 1 builds everything testable in isolation (messages, codec, protocol parsing). Receiver and Transmitter are the hardest logic -- verify them with unit tests before touching real sockets.
- Phase 2 brings in the platform-dependent transport. At this point, `write()` commands work end-to-end. This is a natural milestone: connect + login + write.
- Phase 3 adds streaming (RStream) and the full RouterOSAPI surface. RStream depends on Channel which depends on Connector interface -- all ready by Phase 2.
- Phase 4 is pure tooling/config, no code logic.

### Phase Research Flags

| Phase | Likely Needs Deeper Research | Reason |
|-------|------------------------------|--------|
| Phase 2 | react-native-tcp-socket TLS integration | Cert loading model differs from Node; need to verify self-signed cert works on both iOS and Android |
| Phase 2 | MD5 compatibility | Must match exact RouterOS challenge-response format (00 hex prefix + hex digest) |
| Phase 3 | RStream pause/resume behavior | The /cancel flow creates a temp Channel; verify RN timer behavior matches Node |
| Phase 1 | win1252 round-trip correctness | Must exactly match iconv-lite output for all RouterOS sentence encodings |



## Key Findings Summary

1. **80% of the codebase ports verbatim.** The protocol layer (Receiver, Transmitter, Channel, RStream) and API orchestration (RouterOSAPI) contain zero Node-specific logic beyond their imports.

2. **Three isolated replacements needed:** Transport (`net`/`tls` -> `react-native-tcp-socket`), Encoding (`iconv-lite` -> custom win1252), and Crypto (`crypto.md5` -> pure-JS MD5). Each is a well-scoped, testable unit.

3. **Socket API is highly compatible.** `react-native-tcp-socket` intentionally mirrors Node's `net.Socket` API. The only material diff is socket creation (`createConnection` factory vs `new Socket()`) and TLS option format (`require()` vs file paths).

4. **The `tlsClientError` event does not exist in RN-TCP.** This is the only event wiring change. TLS errors surface as regular `'error'` events, which the Connector already handles.

5. **`socket.emit('fatal')` is custom code, not a Node API.** It works identically on any EventEmitter. No migration risk.

6. **win1252 codec is trivial.** A 256-entry lookup table for decode, a reverse map for encode. ~50 lines. Exact behavior can be verified against the original `iconv-lite` output.

7. **MD5 is the simplest replacement.** Only used in one place (login challenge-response). The challenge input is always <128 bytes. A tiny pure-JS implementation or the `ts-md5` package (3KB) suffices.

8. **RN timers work globally.** Remove the `import { clearTimeout } from 'timers'` and use globals. No behavior change.

9. **Build parallelism is good.** Waves 0 (foundation) and 2 (protocol core) components are fully independent. Only Wave 3 has linear dependencies (Connector -> Channel -> RStream -> RouterOSAPI).

10. **Total estimated new code:** ~1,600 LOC TypeScript across all components. The original `dist/` is ~1,200 LOC of JavaScript. The increase accounts for TypeScript type annotations and the 3 replacement modules (win1252, SocketAdapter, md5).

---

*Research complete. This document informs the ROADMAP.md phase structure and PLAN.md task breakdown.*





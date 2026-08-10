---
phase: 02-protocol-connection
plan: 02
type: execute
wave: 1
depends_on: ["01-foundation"]
files_modified:
  - package.json
  - src/transport/SocketAdapter.ts
  - src/Transmitter.ts
  - src/Receiver.ts
  - src/Connector.ts
  - src/Channel.ts
  - src/RouterOSAPI.ts
  - src/index.ts
autonomous: true
requirements:
  - CONN-01
  - CONN-02
  - CONN-03
  - CONN-04
  - CONN-05
  - AUTH-01
  - AUTH-02
  - AUTH-03
  - ERR-01
  - ERR-03

must_haves:
  truths:
    - "npx tsc --noEmit passes with strict:true and produces zero errors across all Phase 2 modules plus Phase 1"
    - "SocketAdapter.createPlainSocket() returns a socket whose event API (data, error, close, connect, timeout) and methods (write, destroy, end, setTimeout, setKeepAlive) match Node net.Socket exactly — consumer code sees no difference"
    - "SocketAdapter.createTlsSocket() returns a TLS socket accepting self-signed certs via `ca` option, with TLS errors surfaced as standard 'error' events (no tlsClientError dependency)"
    - "Transmitter.encodeString(str) produces length-prefixed RouterOS frames using win1252.encode() from Phase 1, matching original Transmitter.js byte output for all inputs"
    - "Receiver.processRawData(bytes) correctly parses RouterOS binary protocol sentences (!done, !trap, !fatal, !re, !empty), routes them by .tag, and emits 'fatal' on socket for !fatal replies"
    - "Channel.write(params) appends .tag=<id>, returns a Promise that resolves with data on !done and rejects with RosException on !trap"
    - "RouterOSAPI.connect() → login flow completes end-to-end: TCP/TLS socket established, MD5 challenge-response auth against RouterOS v6 and v7, Promise resolved on success or rejected with CANTLOGIN RosException on failure"
    - "Socket-level errors (connect timeout SOCKTMOUT, connection refused ECONNREFUSED, TLS handshake failure) emit RosException with correct errno — not generic strings"
    - "RouterOSAPI.close() destroys the socket, resets connected/connecting/closing flags, and allows re-connection via setOptions() then connect() on the same instance"
  artifacts:
    - package.json (updated: react-native-tcp-socket, events, debug added to dependencies)
    - src/transport/SocketAdapter.ts
    - src/Transmitter.ts
    - src/Receiver.ts
    - src/Connector.ts
    - src/Channel.ts
    - src/RouterOSAPI.ts
    - src/index.ts (updated barrel with Phase 2 exports)
  key_links:
    - "SocketAdapter → types.ts (IRosOptions, TlsRnOptions)"
    - "Transmitter → win1252.ts (encodeWin1252)"
    - "Receiver → win1252.ts (decodeWin1252) + RosException.ts"
    - "Connector → SocketAdapter + Transmitter + Receiver + RosException"
    - "Channel → RosException + Connector (interface: read, write, stopRead)"
    - "RouterOSAPI → Connector + Channel + md5.ts (md5Hash) + RosException + types"
    - "RouterOSAPI.connect() → Connector.connect() → Connector.on('connected') → login() → write('/login',...) → MD5 challenge → write('/login',...) → resolve/reject"
---

<objective>
Wire up real TCP/TLS transport to a RouterOS device. Build the three protocol-layer components (SocketAdapter, Transmitter, Receiver) and the three API-layer components (Connector, Channel, RouterOSAPI.connect/login). The full connect → login → close lifecycle works end-to-end against a real RouterOS v6/v7 device over plain TCP (port 8728) or TLS (port 8729).

Purpose: Deliver the first working milestone — a consumer can `new RouterOSAPI({host, user, password})`, `.connect()`, authenticate via MD5 challenge-response, and `.close()`. All 10 Phase 2 requirements (CONN-01..05, AUTH-01..03, ERR-01, ERR-03) are satisfied.

Output: 7 new source files + updated barrel + updated package.json. Phase 2 depends on every Phase 1 module (types, messages, RosException, win1252, utils, md5).
</objective>

<execution_context>
@C:/Users/Asem/.config/opencode/gsd-core/workflows/execute-plan.md
@C:/Users/Asem/.config/opencode/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/ROADMAP.md
@.planning/REQUIREMENTS.md
@.planning/research/ARCHITECTURE.md
@.planning/research/PITFALLS.md
@.planning/research/STACK.md
@.planning/PROJECT.md
@node-routeros/dist/connector/Connector.js
@node-routeros/dist/connector/Receiver.js
@node-routeros/dist/connector/Transmitter.js
@node-routeros/dist/Channel.js
@node-routeros/dist/RouterOSAPI.js (login section: lines 345-402)
@node-routeros/dist/RosException.js
@src/types.ts
@src/win1252.ts
@src/md5.ts
@src/RosException.ts
@src/messages.ts
</context>

<tasks>

<!-- ============================================================ -->
<!-- WAVE 1: Transport + Protocol Primitives (parallel — 3 tasks)  -->
<!-- ============================================================ -->

<!-- ============== TASK 1: Install Runtime Dependencies ============== -->
<task type="tracer">
  <name>Install runtime dependencies: react-native-tcp-socket, events, debug</name>
  <files>package.json</files>
  <action>
Install the three runtime dependencies that Phase 2 needs. These were identified in STACK.md and deferred from Phase 1 (which had zero runtime deps).

**npm install:**
```
npm install react-native-tcp-socket@^6.4.2 events@^3.3.0 debug@^4.4.3
```

**npm install --save-dev:**
```
npm install --save-dev @types/debug@^4.1
```

**package.json** after install will have:
- `"dependencies"`: `"react-native-tcp-socket": "^6.4.2"`, `"events": "^3.3.0"`, `"debug": "^4.4.3"`, `"js-md5": "^0.9.2"` (js-md5 was installed in Phase 1 Task 3)
- `"devDependencies"`: `"@types/debug": "^4.1"` (plus existing typescript, jest, ts-jest, @types/jest from Phase 1)

Verify `node_modules/react-native-tcp-socket/lib/typescript/src/index.js` exists — this is the TypeScript-compiled entry point. Its package.json has `"main": "./lib/commonjs/index.js"` and `"types": "./lib/typescript/src/index.d.ts"`.

Read `react-native-tcp-socket`'s TypeScript `.d.ts` to understand the exact `TcpSocket` type exports: look for `createConnection`, `connectTLS`, and the `TcpSocket` class/interface. This informs the SocketAdapter typing in Task 2.

Read first: STACK.md runtime dependencies table, ARCHITECTURE.md react-native-tcp-socket API comparison section.
  </action>
  <verify>
    <automated>
# Verify dependencies installed
node -e "
const tcp = require('react-native-tcp-socket');
console.log('tcp-socket exports:', Object.keys(tcp).join(', '));
console.log('createConnection present:', typeof tcp.createConnection === 'function');
console.log('connectTLS present:', typeof tcp.connectTLS === 'function');
const events = require('events');
console.log('events EventEmitter:', typeof events.EventEmitter === 'function');
const debug = require('debug');
console.log('debug:', typeof debug === 'function');
"
    </automated>
  </verify>
  <done>
- `npm install` completes without errors
- `react-native-tcp-socket` resolves and exports `createConnection` and `connectTLS` functions
- `events` resolves and exports `EventEmitter` class
- `debug` resolves as a function
- `@types/debug` installed as devDependency
- `package.json` dependencies and devDependencies reflect all 4 packages
  </done>
</task>

<!-- ============== TASK 2: SocketAdapter ============== -->
<task type="auto">
  <name>Build SocketAdapter: normalize react-native-tcp-socket API to Node net.Socket</name>
  <files>src/transport/SocketAdapter.ts</files>
  <action>
Create the transport abstraction layer. SocketAdapter normalizes the RN-TCP socket creation model (factory functions) into a shape that the Connector (ported verbatim from node-routeros) can consume as if it were a Node `net.Socket`.

**Location:** `src/transport/SocketAdapter.ts` — new `transport/` subdirectory.

**Design decisions (from ARCHITECTURE.md and PITFALLS.md):**
- RN-TCP uses `TcpSocket.createConnection({port, host}, callback)` for plain TCP (Node uses `new net.Socket()` + `socket.connect(port, host)`).
- RN-TCP uses `TcpSocket.connectTLS({port, host, ca, key, cert, ...}, callback)` for TLS (Node uses `tls.connect(port, host, options, callback)`).
- Both RN-TCP factory methods accept a callback that fires on connect — this replaces `socket.once('connect', ...)` and eliminates the race condition that Node's pattern has.
- The `tlsClientError` event does NOT exist in RN-TCP → TLS handshake failures surface as regular `'error'` events (which the Connector already listens to). Remove this event listener from the Connector port.
- `connectTimeout` is a separate RN-TCP option (not `setTimeout` before connect). Set it when creating the socket.
- The returned RN-TCP socket object has the same post-creation API as Node `net.Socket`: `.write(data)`, `.destroy()`, `.end()`, `.setTimeout(ms)`, `.setKeepAlive(enable)`, `.writable`, and events `'data'`, `'error'`, `'close'`, `'timeout'`. The only missing event is `'end'` — use `'close'` instead (see PITFALLS.md #1).

**Implementation:**

```typescript
import { TcpSocket, TcpSocketOptions, TlsOptions } from 'react-native-tcp-socket';
import { TlsRnOptions } from '../types';
import createDebug from 'debug';

const debug = createDebug('routeros-api:transport:socket-adapter');

/**
 * Normalized socket type that matches Node net.Socket API.
 * Both plain TCP and TLS sockets from react-native-tcp-socket
 * satisfy this interface post-creation.
 */
export type RosSocket = TcpSocket;

export interface CreateSocketOptions {
  host: string;
  port: number;
  timeout: number;         // seconds → converted to ms for connectTimeout
  tls?: TlsRnOptions;      // undefined = plain TCP
}

/**
 * Create a plain TCP socket (port 8728).
 * Mirrors original Connector.js non-TLS branch:
 *   new net.Socket() → socket.connect(port, host)
 */
export function createPlainSocket(options: CreateSocketOptions): RosSocket {
  debug('Creating plain TCP socket to %s:%d', options.host, options.port);
  const socket = TcpSocket.createConnection(
    {
      port: options.port,
      host: options.host,
      connectTimeout: options.timeout * 1000,
    },
    () => {
      debug('Plain TCP connected to %s:%d', options.host, options.port);
    }
  );
  return socket;
}

/**
 * Create a TLS socket (port 8729).
 * Mirrors original Connector.js TLS branch:
 *   tls.connect(port, host, options, callback)
 *
 * TLS option mapping (RN-TCP vs Node tls.connect):
 *   - Node `rejectUnauthorized` → RN-TCP: no equivalent; always accepts if `ca` is provided
 *   - Node `ca` as string/Buffer → RN-TCP: `ca` as string (PEM content)
 *   - Node `key` as string/Buffer → RN-TCP: `key` as string (PEM content)
 *   - Node `cert` as string/Buffer → RN-TCP: `cert` as string (PEM content)
 *   - Node file paths → RN-TCP: consumer uses `require('./cert.pem')` (Metro-bundled)
 *
 * IMPORTANT: No `tlsClientError` event. TLS errors surface as regular 'error'
 * events on the socket. The Connector port removes the `tlsClientError` line.
 */
export function createTlsSocket(options: CreateSocketOptions): RosSocket {
  debug('Creating TLS socket to %s:%d', options.host, options.port);

  const tlsOpts: TlsOptions = {
    port: options.port,
    host: options.host,
    connectTimeout: options.timeout * 1000,
  };

  // Map TlsRnOptions to RN-TCP TlsOptions
  if (options.tls) {
    if (options.tls.ca !== undefined) {
      tlsOpts.ca = options.tls.ca;
    }
    if (options.tls.key !== undefined) {
      tlsOpts.key = options.tls.key;
    }
    if (options.tls.cert !== undefined) {
      tlsOpts.cert = options.tls.cert;
    }
    // certAlias and keyAlias for Android keystore — pass through if provided
    if (options.tls.certAlias !== undefined) {
      tlsOpts.certAlias = options.tls.certAlias;
    }
    if (options.tls.keyAlias !== undefined) {
      tlsOpts.keyAlias = options.tls.keyAlias;
    }
  }

  const socket = TcpSocket.connectTLS(tlsOpts, () => {
    debug('TLS connected to %s:%d', options.host, options.port);
  });

  return socket;
}
```

**Key points:**
- Export only the factory functions AND the `RosSocket` type alias. No class needed — these are stateless factory functions.
- The Connector will call `createPlainSocket()` or `createTlsSocket()` based on `this.tls` being set.
- The returned socket is a plain `TcpSocket` — the Connector wires all event listeners (`data`, `error`, `close`, `timeout`) and calls `setTimeout()` + `setKeepAlive()`.
- TLS option mapping is explicit — no implicit property spread that could silently drop unsupported options.

**Pitfall mitigations:**
- PITFALLS.md #1 (socket.on('end') never fires): Connector will listen to `'close'` not `'end'`. The original code uses both — we replace `socket.once('end', ...)` with `socket.once('close', ...)` in the Connector.
- PITFALLS.md #8 (TLS cert handling): Pass `ca` as PEM string via `require()` or inline. Documented in SocketAdapter comment block.
- PITFALLS.md #5 (TOCTOU write race): Transmitter's write pool guards against pre-connect writes. SocketAdapter does not need to handle this.
- PITFALLS.md #18 (multiple connect calls): The Connector's `connect()` method gates on `this.connected`/`this.connecting` flags (preserved from original). SocketAdapter is a factory — each call creates a new socket.

Read first: ARCHITECTURE.md react-native-tcp-socket API comparison table (entire section), PITFALLS.md sections #1 and #8, STACK.md react-native-tcp-socket row.
  </action>
  <verify>
    <automated>
# Verify SocketAdapter compiles and exports
node -e "
// TypeScript compilation is the primary gate (next task verifies tsc --noEmit)
// This script verifies the module structure is correct
const fs = require('fs');
const content = fs.readFileSync('./src/transport/SocketAdapter.ts', 'utf8');
console.log('File exists: true');
console.log('Exports createPlainSocket:', content.includes('export function createPlainSocket'));
console.log('Exports createTlsSocket:', content.includes('export function createTlsSocket'));
console.log('Exports RosSocket type:', content.includes('export type RosSocket'));
console.log('Imports from react-native-tcp-socket:', content.includes('react-native-tcp-socket'));
console.log('Imports from ../types:', content.includes('../types'));
// Verify NO Node.js imports
console.log('NO Node net import:', !content.includes(\"from 'net'\\\") && !content.includes('require(\"net\")'));
console.log('NO Node tls import:', !content.includes(\"from 'tls'\\\") && !content.includes('require(\"tls\")'));
"
    </automated>
  </verify>
  <done>
- `src/transport/SocketAdapter.ts` compiles as part of full `tsc --noEmit` (verified in Task 8)
- `createPlainSocket` accepts host, port, timeout and returns a TcpSocket
- `createTlsSocket` accepts host, port, timeout, tls options and returns a TcpSocket
- TLS options: `ca`, `key`, `cert`, `certAlias`, `keyAlias` are mapped from `TlsRnOptions` to `TlsOptions`
- Zero Node.js imports (`net`, `tls`, `Buffer`, `crypto` are absent)
- `RosSocket` type alias resolves to `TcpSocket`
- `connectTimeout` is set (from `options.timeout * 1000`) in both factory functions
  </done>
</task>

<!-- ============== TASK 3: Transmitter ============== -->
<task type="auto">
  <name>Port Transmitter: win1252 length-prefixed frame builder</name>
  <files>src/Transmitter.ts</files>
  <action>
Port the original `Transmitter.js` to TypeScript, replacing `iconv-lite` with Phase 1's `encodeWin1252`.

**Source reference:** `node-routeros/dist/connector/Transmitter.js`

**Implementation:**

```typescript
import createDebug from 'debug';
import { encodeWin1252 } from './win1252';
import { RosSocket } from './transport/SocketAdapter';

const debug = createDebug('routeros-api:connector:transmitter');

/**
 * Class responsible for transmitting data over the
 * socket to the RouterOS device.
 *
 * Ported verbatim from node-routeros Transmitter.js.
 * Only change: iconv.encode(str, 'win1252') → encodeWin1252(str).
 */
export class Transmitter {
  /**
   * Pool of pre-encoded data frames to be sent after the socket connects.
   * When the socket is not yet writable, frames are queued here and
   * flushed by runPool() when the connection is established.
   */
  private pool: Uint8Array[] = [];

  private socket: RosSocket;

  constructor(socket: RosSocket) {
    this.socket = socket;
  }

  /**
   * Write data over the socket. If the socket is not writable yet
   * (or there are items queued in the pool), save to pool for later
   * flush via runPool().
   *
   * @param data  String to encode, or null for end-of-sentence marker (0x00 byte)
   */
  write(data: string | null): void {
    const encodedData = this.encodeString(data);
    if (!this.socket.writable || this.pool.length > 0) {
      debug('Socket not writable, saving %o in the pool', data);
      this.pool.push(encodedData);
    } else {
      debug('Writing command %s over the socket', data);
      this.socket.write(encodedData);
    }
  }

  /**
   * Flush all data frames stored in the pool.
   * Called by Connector.onConnect() after the socket connection is established.
   *
   * Uses FIFO order — frames are written in the order they were queued.
   */
  runPool(): void {
    debug('Running stacked command pool');
    let data: Uint8Array | undefined;
    while (this.pool.length > 0) {
      data = this.pool.shift();
      if (data) {
        this.socket.write(data);
      }
    }
  }

  /**
   * Encode a string (or null terminator) into a RouterOS length-prefixed frame.
   *
   * RouterOS word encoding (from the API protocol spec):
   * - Length < 0x80        → 1 byte: [len]
   * - Length < 0x4000      → 2 bytes: [len|0x8000] (big-endian)
   * - Length < 0x200000    → 3 bytes: [len|0xC00000]
   * - Length < 0x10000000  → 4 bytes: [len|0xE0000000]
   * - Length >= 0x10000000 → 5 bytes: [0xF0][len as 4 byte big-endian]
   *
   * null input → sentence terminator: single 0x00 byte.
   *
   * @param str  Content string to encode (win1252), or null for terminator.
   * @returns    Uint8Array containing length prefix + encoded content.
   */
  private encodeString(str: string | null): Uint8Array {
    // Sentence terminator
    if (str === null) {
      return new Uint8Array([0x00]);
    }

    // Encode content to win1252 bytes using Phase 1 codec
    const encoded = encodeWin1252(str);
    const len = encoded.length;
    let result: Uint8Array;
    let offset = 0;

    if (len < 0x80) {
      // 1-byte length prefix
      result = new Uint8Array(len + 1);
      result[offset++] = len;
    } else if (len < 0x4000) {
      // 2-byte length prefix (0x8000 flag)
      result = new Uint8Array(len + 2);
      const marked = len | 0x8000;
      result[offset++] = (marked >> 8) & 0xff;
      result[offset++] = marked & 0xff;
    } else if (len < 0x200000) {
      // 3-byte length prefix (0xC00000 flag)
      result = new Uint8Array(len + 3);
      const marked = len | 0xc00000;
      result[offset++] = (marked >> 16) & 0xff;
      result[offset++] = (marked >> 8) & 0xff;
      result[offset++] = marked & 0xff;
    } else if (len < 0x10000000) {
      // 4-byte length prefix (0xE0000000 flag)
      result = new Uint8Array(len + 4);
      const marked = len | 0xe0000000;
      result[offset++] = (marked >> 24) & 0xff;
      result[offset++] = (marked >> 16) & 0xff;
      result[offset++] = (marked >> 8) & 0xff;
      result[offset++] = marked & 0xff;
    } else {
      // 5-byte length prefix (0xF0 followed by 4-byte big-endian)
      result = new Uint8Array(len + 5);
      result[offset++] = 0xf0;
      result[offset++] = (len >> 24) & 0xff;
      result[offset++] = (len >> 16) & 0xff;
      result[offset++] = (len >> 8) & 0xff;
      result[offset++] = len & 0xff;
    }

    // Copy encoded content after the length prefix
    result.set(encoded, offset);
    return result;
  }
}
```

**Key points — what changed from original:**
1. `iconv.encode(str, 'win1252')` → `encodeWin1252(str)` from Phase 1 (returns `Uint8Array`)
2. `Buffer.alloc(n)` → `new Uint8Array(n)` (no Buffer in RN/Hermes — PITFALLS.md #14)
3. `data.fill(encoded, offset)` → `result.set(encoded, offset)` (Uint8Array API)
4. Type annotations added: `pool` is `Uint8Array[]`, `socket` is `RosSocket`, `encodeString` returns `Uint8Array`

**What stays identical:**
- Length encoding algorithm (5 branches, identical flag values and bit masks)
- Pool behavior (queue pre-connect, flush on connect via `runPool()`)
- `write(null)` → `0x00` terminator byte (PITFALLS.md #4 — only valid null byte)
- Debug namespace: `routeros-api:connector:transmitter`

Read first: `node-routeros/dist/connector/Transmitter.js` (full file — 109 lines), PITFALLS.md #3 (win1252 encoding) and #4 (0x00 null byte).
  </action>
  <verify>
    <automated>
# Verify Transmitter.encodeString produces correct length-prefixed frames
node -e "
const { Transmitter } = require('./src/Transmitter');
// We can't instantiate without a real socket, but we can inspect the class
console.log('Transmitter class exported:', typeof Transmitter === 'function');
// Verify the module imports win1252 (no iconv-lite)
const fs = require('fs');
const content = fs.readFileSync('./src/Transmitter.ts', 'utf8');
console.log('Uses encodeWin1252:', content.includes('encodeWin1252'));
console.log('NO iconv-lite:', !content.includes('iconv-lite') && !content.includes('iconv'));
console.log('NO Buffer.alloc:', !content.includes('Buffer.alloc'));
console.log('Uses Uint8Array:', content.includes('Uint8Array'));
console.log('Has runPool:', content.includes('runPool'));
console.log('Has encodeString:', content.includes('encodeString'));
console.log('Length encoding branches:', (content.match(/0x80|0x4000|0x200000|0x10000000/g) || []).length >= 5);
"
    </automated>
  </verify>
  <done>
- `src/Transmitter.ts` compiles as part of full `tsc --noEmit` (verified in Task 8)
- `encodeString` implements all 5 length-prefix branches matching original bit flags
- `encodeString(null)` returns `Uint8Array([0x00])` — sentence terminator
- `encodeString(str)` uses `encodeWin1252(str)` from Phase 1 (not iconv-lite)
- Pool behavior: `write()` queues to `pool` when socket is not writable OR pool has pending items
- `runPool()` flushes pool in FIFO order via `pool.shift()`
- Zero Node.js APIs: no `Buffer`, no `iconv-lite`
- All byte arrays are `Uint8Array` (Hermes-compatible — PITFALLS.md #14)
  </done>
</task>

<!-- ============== TASK 4: Receiver ============== -->
<task type="auto">
  <name>Port Receiver: RouterOS binary protocol parser</name>
  <files>src/Receiver.ts</files>
  <action>
Port the original `Receiver.js` to TypeScript, replacing `iconv-lite` with Phase 1's `decodeWin1252`. This is the most complex single module in Phase 2 (~250 lines).

**Source reference:** `node-routeros/dist/connector/Receiver.js` (306 lines)

**Implementation outline:**

```typescript
import createDebug from 'debug';
import { decodeWin1252 } from './win1252';
import { RosException } from './RosException';
import { RosSocket } from './transport/SocketAdapter';

const debug = createDebug('routeros-api:connector:receiver');

/** Single 0x00 byte — RouterOS sentence terminator */
const NULL_BYTE = new Uint8Array([0x00]);

interface TagEntry {
  name: string;
  callback: (packet: string[]) => void;
}

interface SentenceEntry {
  sentence: string;
  hadMore: boolean;
}

/**
 * Class responsible for receiving and parsing socket data,
 * decoding RouterOS sentences, and routing them to registered
 * tag callbacks.
 *
 * Ported verbatim from node-routeros Receiver.js.
 * Only change: iconv.decode(data, 'win1252') → decodeWin1252(bytes).
 */
export class Receiver {
  /** Registered tag callbacks — keyed by tag string */
  private tags = new Map<string, TagEntry>();

  /** Remaining bytes expected for the current word being read */
  private dataLength = 0;

  /** Queue of parsed sentences awaiting processing */
  private sentencePipe: SentenceEntry[] = [];

  /** Guard to prevent concurrent sentence processing */
  private processingSentencePipe = false;

  /** Current word being accumulated from socket data */
  private currentLine = '';

  /** Current reply type (!done, !trap, !fatal, !re, !empty) */
  private currentReply = '';

  /** Current tag for the sentence being processed */
  private currentTag = '';

  /** Accumulated data lines for the current tag's response */
  private currentPacket: string[] = [];

  /**
   * Partial length-descriptor bytes carried over from a previous
   * processRawData() call when the descriptor spanned a chunk boundary.
   */
  private lengthDescriptorSegment: Uint8Array | null = null;

  private socket: RosSocket;

  constructor(socket: RosSocket) {
    this.socket = socket;
  }

  /**
   * Register a tag to receive data callbacks.
   * Called by Connector.read() → Channel.readAndWrite().
   */
  read(tag: string, callback: (packet: string[]) => void): void {
    debug('Reader of %s tag is being set', tag);
    this.tags.set(tag, { name: tag, callback });
  }

  /**
   * Remove a tag from the registry.
   * Called by Connector.stopRead() → Channel.close().
   */
  stop(tag: string): void {
    debug('Not reading from %s tag anymore', tag);
    this.tags.delete(tag);
  }

  /**
   * Process raw binary data received from the socket.
   *
   * Decodes RouterOS length-prefixed words using win1252,
   * assembles sentences, and pushes them to the sentence pipe.
   * After each sentence boundary, triggers processSentence().
   *
   * @param data  Raw bytes from socket 'data' event.
   */
  processRawData(data: Uint8Array): void {
    // If we have a partial length descriptor from a previous chunk,
    // prepend it to the new data.
    if (this.lengthDescriptorSegment) {
      const combined = new Uint8Array(
        this.lengthDescriptorSegment.length + data.length
      );
      combined.set(this.lengthDescriptorSegment);
      combined.set(data, this.lengthDescriptorSegment.length);
      data = combined;
      this.lengthDescriptorSegment = null;
    }

    // Loop through the data we just received
    while (data.length > 0) {
      // If this does not contain the beginning of a packet...
      if (this.dataLength > 0) {
        // If the length of the data we have is ≤ the reported word length
        if (data.length <= this.dataLength) {
          // Subtract the bytes we are consuming
          this.dataLength -= data.length;
          // Decode this chunk and append to current line
          this.currentLine += decodeWin1252(data);
          // If we've consumed the full word
          if (this.dataLength === 0) {
            // Push the sentence to the pipe
            this.sentencePipe.push({
              sentence: this.currentLine,
              hadMore: false, // data.length is 0 here since we consumed all
            });
            // Process the sentence and clear the line
            this.processSentence();
            this.currentLine = '';
          }
          // Break out and wait for the next data chunk from the socket
          break;
        } else {
          // We have more data than the current word demands
          // Slice off exactly the portion we need for this word
          const wordBytes = data.slice(0, this.dataLength);
          // Decode this segment
          const wordStr = decodeWin1252(wordBytes);
          // Add to current line
          this.currentLine += wordStr;
          // Save the completed line
          const line = this.currentLine;
          // Reset for the next word
          this.currentLine = '';
          // Cut off the bytes we just consumed
          data = data.slice(this.dataLength);
          // Determine the length of the NEXT word
          const [descriptorLength, length] = this.decodeLength(data);
          // If the length descriptor spans a chunk boundary,
          // store the descriptor fragment and wait for more data
          if (descriptorLength > data.length) {
            this.lengthDescriptorSegment = data;
          }
          // Save the next word's length
          this.dataLength = length;
          // Slice off the length descriptor bytes
          data = data.slice(descriptorLength);
          // Check for sentence terminator (0x00 byte with length 1)
          if (this.dataLength === 1 && this.bytesEqual(data, NULL_BYTE)) {
            this.dataLength = 0;
            data = data.slice(1); // consume the terminator
          }
          // Push the completed line to the sentence pipe
          this.sentencePipe.push({
            sentence: line,
            hadMore: data.length > 0,
          });
          // Process the sentence
          this.processSentence();
        }
      } else {
        // This is the BEGINNING of a new word — decode its length
        const [descriptorLength, length] = this.decodeLength(data);
        // Store how long the word content is
        this.dataLength = length;
        // Slice off the length descriptor bytes
        data = data.slice(descriptorLength);
        // Check for sentence terminator
        if (this.dataLength === 1 && this.bytesEqual(data, NULL_BYTE)) {
          this.dataLength = 0;
          data = data.slice(1); // consume the terminator
        }
      }
    }
  }

  /**
   * Process sentences from the pipe one at a time.
   * Detects .tag= lines, routes completed packets to registered
   * tag callbacks, and emits 'fatal' on the socket for !fatal replies.
   *
   * Guarded by processingSentencePipe flag to prevent concurrent processing.
   */
  processSentence(): void {
    if (!this.processingSentencePipe) {
      debug('Got asked to process sentence pipe');
      this.processingSentencePipe = true;
      const process = () => {
        if (this.sentencePipe.length > 0) {
          const line = this.sentencePipe.shift()!;
          // !fatal without more data → connection-level fatal error
          // Emit 'fatal' on socket → Connector.onEnd() → close + destroy
          if (!line.hadMore && this.currentReply === '!fatal') {
            this.socket.emit('fatal');
            return;
          }
          debug('Processing line %s', line.sentence);
          // Detect .tag= line → set current tag
          if (/^\.tag=/.test(line.sentence)) {
            this.currentTag = line.sentence.substring(5);
          }
          // Detect reply type (!done, !trap, !fatal, !re, !empty)
          else if (/^!/.test(line.sentence)) {
            // If we already have a tag and receive another reply,
            // send the accumulated data to the tag before switching
            if (this.currentTag) {
              debug(
                'Received another response, sending current data to tag %s',
                this.currentTag
              );
              this.sendTagData(this.currentTag);
            }
            this.currentPacket.push(line.sentence);
            this.currentReply = line.sentence;
          }
          // Regular data line → accumulate
          else {
            this.currentPacket.push(line.sentence);
          }
          // If the pipe is drained and no more data is expected...
          if (this.sentencePipe.length === 0 && this.dataLength === 0) {
            if (!line.hadMore && this.currentTag) {
              debug(
                'No more sentences to process, will send data to tag %s',
                this.currentTag
              );
              this.sendTagData(this.currentTag);
            } else {
              debug('No more sentences and no data to send');
            }
            this.processingSentencePipe = false;
          } else {
            // More sentences in the pipe — recurse
            process();
          }
        } else {
          this.processingSentencePipe = false;
        }
      };
      process();
    }
  }

  /**
   * Send the accumulated packet data to the registered tag callback.
   * Throws UNREGISTEREDTAG if the tag was not found (protocol error).
   */
  private sendTagData(currentTag: string): void {
    const tag = this.tags.get(currentTag);
    if (tag) {
      debug('Sending to tag %s the packet %O', tag.name, this.currentPacket);
      tag.callback(this.currentPacket);
    } else {
      throw new RosException('UNREGISTEREDTAG');
    }
    this.cleanUp();
  }

  /**
   * Reset current packet, tag, and reply state for the next sentence.
   */
  private cleanUp(): void {
    this.currentPacket = [];
    this.currentTag = '';
    this.currentReply = '';
  }

  /**
   * Decode the RouterOS word length from the beginning of the data buffer.
   *
   * RouterOS length encoding (1-5 bytes):
   * - Byte 0 < 0x80        → length = byte 0 (1 byte total)
   * - Byte 0 & 0xC0 = 0x80 → length = ((byte0 & 0x3F) << 8) | byte1 (2 bytes)
   * - Byte 0 & 0xE0 = 0xC0 → length = ((byte0 & 0x1F) << 16) | ... (3 bytes)
   * - Byte 0 & 0xF0 = 0xE0 → length = ((byte0 & 0x0F) << 24) | ... (4 bytes)
   * - Byte 0 = 0xF0         → length = (byte1 << 24) | ... (5 bytes)
   *
   * @param data  Raw bytes (at least 1 byte)
   * @returns     [bytes consumed by length descriptor, decoded content length]
   */
  decodeLength(data: Uint8Array): [number, number] {
    let len: number;
    let idx = 0;
    const b = data[idx++];

    if (b & 0x80) {
      if ((b & 0xc0) === 0x80) {
        len = ((b & 0x3f) << 8) + data[idx++];
      } else {
        if ((b & 0xe0) === 0xc0) {
          len = ((b & 0x1f) << 8) + data[idx++];
          len = (len << 8) + data[idx++];
        } else {
          if ((b & 0xf0) === 0xe0) {
            len = ((b & 0x0f) << 8) + data[idx++];
            len = (len << 8) + data[idx++];
            len = (len << 8) + data[idx++];
          } else {
            len = data[idx++];
            len = (len << 8) + data[idx++];
            len = (len << 8) + data[idx++];
            len = (len << 8) + data[idx++];
          }
        }
      }
    } else {
      len = b;
    }
    return [idx, len];
  }

  /**
   * Compare two Uint8Arrays for equality.
   * Used to detect the NULL_BYTE sentence terminator.
   */
  private bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }
}
```

**Key points — what changed from original:**
1. `iconv.decode(data, 'win1252')` → `decodeWin1252(bytes)` from Phase 1 (returns `string`)
2. All `Buffer` usages → `Uint8Array` (PITFALLS.md #14 — Hermes-compatible)
3. `Buffer.concat([a, b])` → manual `new Uint8Array(a.length + b.length)` + `.set()` calls
4. `data.equals(nullBuffer)` → `this.bytesEqual(data, NULL_BYTE)` — `Uint8Array` has no `.equals()`
5. `NULL_BYTE` defined as `new Uint8Array([0x00])` instead of `Buffer.from([0x00])`
6. Type annotations on all fields and method signatures
7. Debug namespace preserved: `routeros-api:connector:receiver`

**What stays identical:**
- `processRawData()` algorithm — the dataLength, chunk boundary, line assembly logic is verbatim
- `processSentence()` — sentence pipe processing, `.tag=` detection, reply routing, `!fatal` → `socket.emit('fatal')`
- `decodeLength()` — all 5 length-encoding branches, bit masks (0x80, 0xC0, 0xE0, 0xF0), bitwise operations identical
- `sendTagData()` — tag lookup, UNREGISTEREDTAG throw, cleanUp
- `read()` / `stop()` — tag map management

**Pitfall mitigations:**
- PITFALLS.md #9 (!fatal vs !trap): The `!fatal` → `socket.emit('fatal')` chain is preserved exactly. In Connector, `socket.once('fatal', this.onEnd)` triggers close+destroy. This is the correct behavior — `!fatal` is a connection-level fatal error, not a per-channel trap.
- RouterOS v7.18+ `!empty` reply: The `processSentence()` regex `/^!/` matches `!empty`. It gets pushed to `currentPacket` and `currentReply`. When the tag callback receives it, Channel.processPacket() handles it — but only in the `default:` switch case of Channel (which was for unknown replies). However, since we also preserve the original Channel.processPacket() logic (see Task 6), `!empty` will fall into the `default:` case which emits `'unknown'` and closes. This is an existing behavior from node-routeros — `!empty` handling was not in the original v1.6.8 source. It will be addressed in Phase 4 (robustness) as a low-priority fix (PITFALLS.md #16).

Read first: `node-routeros/dist/connector/Receiver.js` (full file — 306 lines), PITFALLS.md #9 (!fatal handling), ARCHITECTURE.md decodeLength section.
  </action>
  <verify>
    <automated>
# Verify Receiver structure and algorithm integrity
node -e "
const fs = require('fs');
const content = fs.readFileSync('./src/Receiver.ts', 'utf8');
console.log('Receiver class exported:', content.includes('export class Receiver'));
console.log('Uses decodeWin1252:', content.includes('decodeWin1252'));
console.log('NO iconv-lite:', !content.includes('iconv-lite') && !content.includes('iconv'));
console.log('NO Buffer:', !content.includes('Buffer.'));
console.log('Has processRawData:', content.includes('processRawData'));
console.log('Has processSentence:', content.includes('processSentence'));
console.log('Has decodeLength:', content.includes('decodeLength'));
console.log('Has sendTagData:', content.includes('sendTagData'));
console.log('Has read/stop:', content.includes('read(') && content.includes('stop('));
console.log('!fatal emits fatal:', content.includes(\"emit('fatal')\"));
console.log('.tag= detection:', content.includes('.tag='));
console.log('Length decode branches:', (content.match(/0x80|0xc0|0xe0|0xf0/g) || []).length >= 5);
console.log('bytesEqual helper:', content.includes('bytesEqual'));
console.log('NULL_BYTE terminator:', content.includes('NULL_BYTE'));
console.log('sentencePipe processing:', content.includes('sentencePipe'));
console.log('currentTag routing:', content.includes('currentTag'));
console.log('processingSentencePipe guard:', content.includes('processingSentencePipe'));
"
    </automated>
  </verify>
  <done>
- `src/Receiver.ts` compiles as part of full `tsc --noEmit` (verified in Task 8)
- `processRawData()` algorithm preserved verbatim from original (chunk boundary handling, word assembly, sentence detection)
- `decodeLength()` implements all 5 length-encoding branches with identical bit masks
- `!fatal` response → `socket.emit('fatal')` preserved (connection-level fatal error handling)
- `.tag=` detection via `/^\.tag=/` regex preserved
- `!done`/`!trap`/`!re`/`!empty` reply routing via `/^!/` regex preserved
- `sendTagData()` throws `RosException('UNREGISTEREDTAG')` for unregistered tags
- `bytesEqual()` helper replaces `Buffer.equals()` for Uint8Array
- Zero Node.js APIs: no `Buffer`, no `iconv-lite`, no `stream`
- All byte arrays are `Uint8Array` (Hermes-compatible)
  </done>
</task>

<!-- ============================================================ -->
<!-- WAVE 2: Connector (depends on Wave 1 — Tasks 2, 3, 4)        -->
<!-- ============================================================ -->

<!-- ============== TASK 5: Connector ============== -->
<task type="auto">
  <name>Port Connector: socket lifecycle, owns Transmitter + Receiver</name>
  <files>src/Connector.ts</files>
  <action>
Port the original `Connector.js` to TypeScript, replacing `net`/`tls` with SocketAdapter and adapting event wiring for RN-TCP.

**Source reference:** `node-routeros/dist/connector/Connector.js` (202 lines)

**Key RN adaptations (from ARCHITECTURE.md and PITFALLS.md):**
1. Socket creation: `new net.Socket()` + `socket.connect(port, host)` → `createPlainSocket()` from SocketAdapter
2. TLS creation: `tls.connect(port, host, options, callback)` → `createTlsSocket()` from SocketAdapter
3. **REMOVE** `socket.on('tlsClientError', ...)` — RN-TCP does not emit this event. TLS errors surface as `'error'` events, which are already handled.
4. **REPLACE** `socket.once('end', ...)` → `socket.once('close', ...)` — RN-TCP does not emit `'end'`. `'close'` fires after the socket is fully closed (PITFALLS.md #1). The semantic difference: Node `'end'` fires when the other side sends FIN (half-close), `'close'` fires when fully closed. For RouterOS connections, these are effectively the same because RouterOS fully closes the connection.
5. TLS options: `this.tls` stores `TlsRnOptions` (not Node `TlsOptions`).
6. Default TLS port: 8729 (same as Node — RouterOS convention).

**Implementation:**

```typescript
import { EventEmitter } from 'events';
import createDebug from 'debug';
import { createPlainSocket, createTlsSocket, RosSocket } from './transport/SocketAdapter';
import { Transmitter } from './Transmitter';
import { Receiver } from './Receiver';
import { RosException } from './RosException';
import { TlsRnOptions } from './types';

const debugInfo = createDebug('routeros-api:connector:connector:info');
const debugError = createDebug('routeros-api:connector:connector:error');

export interface ConnectorOptions {
  host: string;
  port?: number;
  timeout?: number;
  tls?: boolean | TlsRnOptions;
}

/**
 * Connector class responsible for communicating with
 * RouterOS via API, sending and receiving data.
 *
 * Owns the socket (via SocketAdapter), Transmitter, and Receiver.
 * Emits: 'connected', 'close', 'error', 'timeout'
 *
 * Ported from node-routeros Connector.js.
 * RN adaptations:
 *   - SocketAdapter replaces net/tls socket creation
 *   - tlsClientError event removed (RN-TCP surfaces as 'error')
 *   - 'end' event replaced with 'close' (RN-TCP has no 'end')
 */
export class Connector extends EventEmitter {
  private host: string;
  private port: number;
  private timeout: number;
  private tls?: TlsRnOptions;

  private connected = false;
  private connecting = false;
  private closing = false;

  private socket!: RosSocket;
  private transmitter!: Transmitter;
  private receiver!: Receiver;

  constructor(options: ConnectorOptions) {
    super();
    this.host = options.host;
    this.timeout = options.timeout ?? 10;     // default 10 seconds
    this.port = options.port ?? 8728;          // default port 8728 (plain TCP)

    // TLS handling — identical logic to original
    if (typeof options.tls === 'boolean' && options.tls) {
      this.tls = {}; // empty options = enable TLS with defaults
    }
    if (typeof options.tls === 'object') {
      if (!options.port) this.port = 8729;    // default TLS port
      this.tls = options.tls;
    }
  }

  /**
   * Connect to the RouterOS device.
   * Guarded by connected/connecting flags — prevents double-connect (PITFALLS.md #18).
   *
   * @returns this (for chaining)
   */
  connect(): this {
    if (!this.connected) {
      if (!this.connecting) {
        this.connecting = true;

        if (this.tls !== undefined) {
          // TLS connection (port 8729)
          this.socket = createTlsSocket({
            host: this.host,
            port: this.port,
            timeout: this.timeout,
            tls: this.tls,
          });
          this.transmitter = new Transmitter(this.socket);
          this.receiver = new Receiver(this.socket);
          // Wire events — NOTE: no tlsClientError (RN-TCP has none)
          this.socket.on('data', this.onData.bind(this));
          this.socket.on('error', this.onError.bind(this));
          this.socket.once('close', this.onEnd.bind(this));
          this.socket.once('timeout', this.onTimeout.bind(this));
          this.socket.once('fatal', this.onEnd.bind(this));
          this.socket.setTimeout(this.timeout * 1000);
          this.socket.setKeepAlive(true);
          // TLS connect callback fires from createTlsSocket factory
          this.onConnect();
        } else {
          // Plain TCP connection (port 8728)
          this.socket = createPlainSocket({
            host: this.host,
            port: this.port,
            timeout: this.timeout,
          });
          this.transmitter = new Transmitter(this.socket);
          this.receiver = new Receiver(this.socket);
          // Wire events
          this.socket.on('data', this.onData.bind(this));
          this.socket.on('error', this.onError.bind(this));
          this.socket.once('close', this.onEnd.bind(this));
          this.socket.once('timeout', this.onTimeout.bind(this));
          this.socket.once('fatal', this.onEnd.bind(this));
          this.socket.setTimeout(this.timeout * 1000);
          this.socket.setKeepAlive(true);
          // Plain TCP connect callback fires from createPlainSocket factory
          this.onConnect();
        }
      }
    }
    return this;
  }

  /**
   * Write data through the open socket.
   * Each array element is one RouterOS word. null terminator
   * is appended after all words to form a complete sentence.
   *
   * @param data  Array of strings (RouterOS words)
   * @returns this
   */
  write(data: string[]): this {
    for (const line of data) {
      this.transmitter.write(line);
    }
    this.transmitter.write(null); // sentence terminator
    return this;
  }

  /**
   * Register a tag to receive data callbacks from the Receiver.
   *
   * @param tag       Tag string (from Channel.id)
   * @param callback  Called with parsed packet lines
   */
  read(tag: string, callback: (packet: string[]) => void): void {
    this.receiver.read(tag, callback);
  }

  /**
   * Unregister a tag — stop waiting for data.
   *
   * @param tag  Tag string to remove
   */
  stopRead(tag: string): void {
    this.receiver.stop(tag);
  }

  /**
   * Gracefully close the connection.
   * Sends FIN via socket.end(), then onEnd() handles cleanup.
   */
  close(): void {
    if (!this.closing) {
      this.closing = true;
      this.socket.end();
    }
  }

  /**
   * Force-destroy the socket. No more data can be exchanged.
   * Removes all event listeners.
   */
  destroy(): void {
    this.socket.destroy();
    this.removeAllListeners();
  }

  // ──── Private event handlers ────

  /**
   * Connection established callback.
   * Resets connecting flag, flushes the transmitter pool,
   * and emits 'connected' to RouterOSAPI.
   */
  private onConnect(): void {
    this.connecting = false;
    this.connected = true;
    debugInfo('Connected on %s', this.host);
    this.transmitter.runPool();
    this.emit('connected', this);
  }

  /**
   * Socket close/fatal handler.
   * Emits 'close' and destroys the socket + listeners.
   */
  private onEnd(): void {
    this.emit('close', this);
    this.destroy();
  }

  /**
   * Socket error handler.
   * Wraps the error in RosException (if not already) and emits 'error'.
   * Destroys the socket — errors are terminal for the connection.
   */
  private onError(err: Error & { errno?: string }): void {
    const rosErr = err instanceof RosException
      ? err
      : new RosException(err.errno || 'ECONNREFUSED', { message: err.message });
    debugError(
      'Problem while trying to connect to %s. Error: %s',
      this.host,
      rosErr.message
    );
    this.emit('error', rosErr, this);
    this.destroy();
  }

  /**
   * Socket timeout handler.
   * Emits SOCKTMOUT RosException and destroys the socket.
   */
  private onTimeout(): void {
    this.emit(
      'timeout',
      new RosException('SOCKTMOUT', { seconds: String(this.timeout) }),
      this
    );
    this.destroy();
  }

  /**
   * Socket data handler.
   * Forwards raw bytes to the Receiver for protocol parsing.
   */
  private onData(data: Uint8Array): void {
    debugInfo('Got data from the socket, will process it');
    this.receiver.processRawData(data);
  }
}
```

**Key RN adaptations compared to original:**

| Original | RN Port | Reason |
|----------|---------|--------|
| `new net.Socket()` + `socket.connect(port, host)` | `createPlainSocket({host, port, timeout})` | RN-TCP factory pattern |
| `tls.connect(port, host, tlsOpts, callback)` | `createTlsSocket({host, port, timeout, tls})` | RN-TCP factory pattern |
| `socket.on('tlsClientError', ...)` | **REMOVED** | Event doesn't exist in RN-TCP |
| `socket.once('end', ...)` | `socket.once('close', ...)` | RN-TCP has no 'end' event |
| `socket.once('connect', ...)` | Callback from factory (calls `onConnect()` directly) | RN-TCP factory callback replaces connect event |
| `socket.on('error', ...)` (Node error shape) | `socket.on('error', ...)` + `err.errno` extraction | RN-TCP errors have different shape |
| `this.socket.connect(this.port, this.host)` | Not needed — factory handles it | Factory creates AND connects |
| Node `net`/`tls` imports | SocketAdapter imports | Abstraction layer |

**Pitfall mitigations:**
- PITFALLS.md #1 (socket.on('end') never fires): Replaced with `'close'` event. RouterOS always fully closes the connection — behaviorally equivalent for this use case.
- PITFALLS.md #5 (TOCTOU write race): Transmitter.write() guards against this via `socket.writable` check + pool. Connector delegates all writes to Transmitter.
- PITFALLS.md #18 (multiple connect calls): Guarded by `this.connected` and `this.connecting` flags — identical to original.
- `onError()` wraps non-RosException errors — socket-level errors (ECONNREFUSED, TLS handshake) get converted to RosException with the appropriate errno. This satisfies ERR-03.

Read first: `node-routeros/dist/connector/Connector.js` (full file), ARCHITECTURE.md Connector rewrite strategy section, PITFALLS.md sections #1, #5, #8, #18.
  </action>
  <verify>
    <automated>
# Verify Connector structure and RN adaptations
node -e "
const fs = require('fs');
const content = fs.readFileSync('./src/Connector.ts', 'utf8');
console.log('Connector class exported:', content.includes('export class Connector'));
console.log('Extends EventEmitter:', content.includes('extends EventEmitter'));
console.log('Has connect():', content.includes('connect()'));
console.log('Has write():', content.includes('write('));
console.log('Has read():', content.includes('read('));
console.log('Has stopRead():', content.includes('stopRead('));
console.log('Has close():', content.includes('close()'));
console.log('Has destroy():', content.includes('destroy()'));
console.log('Has onConnect():', content.includes('onConnect()'));
console.log('Has onEnd():', content.includes('onEnd()'));
console.log('Has onError():', content.includes('onError('));
console.log('Has onTimeout():', content.includes('onTimeout()'));
console.log('Has onData():', content.includes('onData('));
// RN adaptations
console.log('Uses SocketAdapter:', content.includes('createPlainSocket') && content.includes('createTlsSocket'));
console.log('NO tlsClientError:', !content.includes('tlsClientError'));
console.log('Uses close not end:', content.includes(\"once('close')\") && !content.includes(\"once('end')\"));
console.log('NO Node net import:', !content.includes(\"from 'net'\") && !content.includes('require(\"net\")'));
console.log('NO Node tls import:', !content.includes(\"from 'tls'\") && !content.includes('require(\"tls\")'));
// Connect guard
console.log('Connect guard (connected/connecting):', content.includes('this.connected') && content.includes('this.connecting'));
// Error handling
console.log('onError wraps RosException:', content.includes('RosException'));
console.log('SOCKTMOUT on timeout:', content.includes('SOCKTMOUT'));
// Debug namespaces
console.log('Debug namespaces:', content.includes('routeros-api:connector:connector'));
"
    </automated>
  </verify>
  <done>
- `src/Connector.ts` compiles as part of full `tsc --noEmit` (verified in Task 8)
- `connect()` guards on `connected`/`connecting` flags — no double-connect
- Plain TCP path: `createPlainSocket()` + event wiring + `setTimeout` + `setKeepAlive`
- TLS path: `createTlsSocket()` + event wiring + `setTimeout` + `setKeepAlive`
- `tlsClientError` event completely removed (RN-TCP has none — PITFALLS.md #8)
- `socket.once('end', ...)` replaced with `socket.once('close', ...)` (PITFALLS.md #1)
- `socket.once('connect', ...)` replaced with direct `onConnect()` call from factory callback
- `write(data[])` iterates words → `transmitter.write(line)` → `transmitter.write(null)` terminator
- `read(tag, callback)` → `receiver.read(tag, callback)`
- `stopRead(tag)` → `receiver.stop(tag)`
- `close()` → `socket.end()` (graceful FIN)
- `destroy()` → `socket.destroy()` + `removeAllListeners()`
- `onError()` wraps non-RosException errors with errno extraction (ECONNREFUSED default)
- `onTimeout()` emits `RosException('SOCKTMOUT', ...)` — identical to original
- Debug namespaces preserved: `routeros-api:connector:connector:info` / `:error`
- Zero Node.js imports — all transport through SocketAdapter
  </done>
</task>

<!-- ============================================================ -->
<!-- WAVE 3: Channel + RouterOSAPI (depends on Wave 2)             -->
<!-- ============================================================ -->

<!-- ============== TASK 6: Channel ============== -->
<task type="auto">
  <name>Port Channel: per-command tag, Promise-based done/trap</name>
  <files>src/Channel.ts</files>
  <action>
Port the original `Channel.js` to TypeScript. Channel creates a unique tag for each command, registers a reader on the Connector, and provides a Promise-based API that resolves on `!done` and rejects on `!trap`.

**Source reference:** `node-routeros/dist/Channel.js` (167 lines)

**Implementation:**

```typescript
import { EventEmitter } from 'events';
import createDebug from 'debug';
import { RosException } from './RosException';
import { Connector } from './Connector';

const debugInfo = createDebug('routeros-api:channel:info');
const debugError = createDebug('routeros-api:channel:error');

/**
 * Channel class — generates unique IDs for commands and manages
 * the request/response lifecycle for a single RouterOS API command.
 *
 * Ported verbatim from node-routeros Channel.js.
 */
export class Channel extends EventEmitter {
  /** Accumulated !re data sentences received for this channel */
  private data: Record<string, any>[] = [];

  /** Whether a !trap was received (prevents !done from resolving) */
  private trapped = false;

  /** Whether this channel is for a streaming command */
  private streaming = false;

  /** Unique tag ID for this channel */
  private id: string;

  /** Reference to the parent Connector */
  private connector: Connector;

  constructor(connector: Connector) {
    super();
    // Generate a random tag — matches original Math.random().toString(36).substring(3)
    this.id = Math.random().toString(36).substring(3);
    this.connector = connector;
    // Catch unexpected reply types
    this.once('unknown', this.onUnknown.bind(this));
  }

  /** Public getter for the channel's tag ID */
  get Id(): string {
    return this.id;
  }

  /** Public getter for the parent connector */
  get Connector(): Connector {
    return this.connector;
  }

  /**
   * Write a command to RouterOS over this channel.
   *
   * Appends `.tag=<this.id>` to the params so RouterOS routes
   * the response back to this channel's reader.
   *
   * @param params         Array of RouterOS command words (e.g., ['/login', '=name=admin'])
   * @param isStream       Whether this is a streaming command (default false)
   * @param returnPromise  Whether to return a Promise (default true). false for fire-and-forget.
   * @returns              Promise resolving on !done, rejecting on !trap
   */
  write(
    params: string[],
    isStream: boolean = false,
    returnPromise: boolean | undefined = true
  ): Promise<Record<string, any>[]> | void {
    this.streaming = isStream;

    // Append the channel's tag to the command parameters
    params.push('.tag=' + this.id);

    if (returnPromise) {
      // Collect !re data sentences as they arrive
      this.on('data', (packet: Record<string, any>) => this.data.push(packet));

      return new Promise<Record<string, any>[]>((resolve, reject) => {
        this.once('done', (data) => resolve(data));
        this.once('trap', (data) =>
          reject(new Error(data.message))
        );
        this.readAndWrite(params);
      });
    }

    // Fire-and-forget (used internally by RStream in Phase 3)
    this.readAndWrite(params);
    return;
  }

  /**
   * Close the channel and remove its tag reader from the Connector.
   *
   * @param force  If true, removes ALL listeners. If false (default),
   *               only removes the reader; streaming channels keep listeners alive.
   */
  close(force: boolean = false): void {
    this.emit('close');
    if (!this.streaming || force) {
      this.removeAllListeners();
    }
    this.connector.stopRead(this.id);
  }

  /**
   * Register the tag reader on the Connector and write the command.
   * Called after event listeners are set up in write().
   */
  private readAndWrite(params: string[]): void {
    this.connector.read(this.id, (packet) => this.processPacket(packet));
    this.connector.write(params);
  }

  /**
   * Process a response packet received from RouterOS for this channel.
   *
   * Parses the packet, then routes based on the reply type:
   *   !done  → emit 'done' with accumulated data (resolves the Promise)
   *   !trap  → emit 'trap' with parsed error data (rejects the Promise)
   *   !re    → emit 'data' (non-streaming) or 'stream' (streaming)
   *   !empty → emit 'unknown' (existing behavior; upgraded in Phase 4)
   *   other  → emit 'unknown' and close
   *
   * @param packet  Array of raw response lines from the Receiver
   */
  private processPacket(packet: string[]): void {
    const reply = packet.shift()!;
    debugInfo('Processing reply %s with data %o', reply, packet);

    const parsed = this.parsePacket(packet);

    if (reply === '!trap') {
      this.trapped = true;
      this.emit('trap', parsed);
      return;
    }

    // Non-streaming mode: emit 'data' for !re lines (accumulated by write())
    if (packet.length > 0 && !this.streaming) {
      this.emit('data', parsed);
    }

    switch (reply) {
      case '!re':
        // Streaming mode: emit 'stream' for RStream consumption
        if (this.streaming) {
          this.emit('stream', parsed);
        }
        break;
      case '!done':
        // If !trap was received earlier, don't emit 'done'
        if (!this.trapped) {
          this.emit('done', this.data);
        }
        this.close();
        break;
      default:
        // Unknown reply type — emit 'unknown' which triggers RosException
        this.emit('unknown', reply);
        this.close();
        break;
    }
  }

  /**
   * Parse a raw RouterOS response packet into a key-value object.
   *
   * RouterOS format: ['=interface=ether2', '=status=up']
   * Parsed:          { interface: 'ether2', status: 'up' }
   *
   * @param packet  Array of raw response lines
   * @returns       Parsed key-value object
   */
  private parsePacket(packet: string[]): Record<string, any> {
    const obj: Record<string, any> = {};
    for (const line of packet) {
      const linePair = line.split('=');
      linePair.shift(); // remove leading empty string (line starts with '=')
      const key = linePair.shift();
      if (key) {
        obj[key] = linePair.join('='); // rejoin in case value contains '='
      }
    }
    debugInfo('Parsed line, got %o as result', obj);
    return obj;
  }

  /**
   * Handle unexpected reply types.
   * Throws RosException — this should never happen in normal operation.
   */
  private onUnknown(reply: string): void {
    throw new RosException('UNKNOWNREPLY', { reply });
  }
}
```

**Key points:**
- Channel is a verbatim port. The only change is TypeScript type annotations.
- Tag generation: `Math.random().toString(36).substring(3)` — identical to original (PITFALLS.md #10 — non-empty tags, unique per channel).
- Promise lifecycle: `write()` returns a Promise. `!done` → resolve with accumulated data. `!trap` → reject with Error containing the trap message.
- `!trap` rejection uses `new Error(data.message)` — the original uses this pattern. The consumer's catch block receives this error. In Phase 2, login() in RouterOSAPI catches this and converts to `RosException('CANTLOGIN')` for known auth failure messages.
- `processPacket()` switch matches original exactly: `!re`, `!done`, default (unknown). `!empty` falls into default case.
- `parsePacket()` splits on `=` and handles values containing `=` by re-joining — identical to original.

Read first: `node-routeros/dist/Channel.js` (full file — 167 lines), PITFALLS.md #10 (tag collision).
  </action>
  <verify>
    <automated>
# Verify Channel structure and Promise lifecycle
node -e "
const fs = require('fs');
const content = fs.readFileSync('./src/Channel.ts', 'utf8');
console.log('Channel class exported:', content.includes('export class Channel'));
console.log('Extends EventEmitter:', content.includes('extends EventEmitter'));
console.log('Has write(params, isStream, returnPromise):', content.includes('write('));
console.log('Has close(force):', content.includes('close('));
console.log('Has Id getter:', content.includes('get Id()'));
console.log('Has Connector getter:', content.includes('get Connector()'));
console.log('Tag generation:', content.includes('Math.random().toString(36)'));
console.log('Appends .tag=:', content.includes('.tag='));
console.log('Promise resolve on done:', content.includes(\"once('done'\"));
console.log('Promise reject on trap:', content.includes(\"once('trap'\"));
console.log('processPacket switch:', content.includes('!re') && content.includes('!done'));
console.log('trapped flag:', content.includes('this.trapped'));
console.log('streaming flag:', content.includes('this.streaming'));
console.log('parsePacket split:', content.includes(\"split('=')\"));
console.log('readAndWrite:', content.includes('readAndWrite'));
console.log('onUnknown RosException:', content.includes('UNKNOWNREPLY'));
console.log('Imports Connector:', content.includes(\"import { Connector } from './Connector'\"));
"
    </automated>
  </verify>
  <done>
- `src/Channel.ts` compiles as part of full `tsc --noEmit` (verified in Task 8)
- `write(params)` creates a new Promise, registers 'done'/'trap' listeners, calls `readAndWrite(params)`
- `write(params, isStream)` sets `this.streaming` for RStream support (Phase 3)
- `write(params, isStream, false)` returns void (fire-and-forget — used internally)
- `.tag=<id>` appended to params — RouterOS routes response back to this channel
- Tag generated via `Math.random().toString(36).substring(3)` — unique, non-empty (PITFALLS.md #10)
- `!done` → `emit('done', this.data)` → Promise resolves
- `!trap` → `emit('trap', parsed)` → Promise rejects with Error
- `!trapped` flag prevents `!done` from resolving after a `!trap`
- `!re` in non-streaming mode → `emit('data', parsed)` → accumulated in `this.data`
- `!re` in streaming mode → `emit('stream', parsed)` → for RStream (Phase 3)
- Unknown reply → `emit('unknown')` → `RosException('UNKNOWNREPLY')`
- `close()` removes tag reader from Connector via `connector.stopRead(this.id)`
- `parsePacket()` handles `=` in values via split+rejoin — identical to original
- Verbatin port — zero logic changes from original Channel.js
  </done>
</task>

<!-- ============== TASK 7: RouterOSAPI ============== -->
<task type="auto">
  <name>Port RouterOSAPI: connect() + MD5 login + close() lifecycle</name>
  <files>src/RouterOSAPI.ts</files>
  <action>
Port the connection lifecycle and authentication portions of `RouterOSAPI.js`. This task delivers `connect()`, `login()` (MD5 challenge-response), `setOptions()`, `close()`, and the helper methods needed for these. `write()`, `writeStream()`, and `stream()` are deferred to Phase 3 — they will be added to this same file.

**Source reference:** `node-routeros/dist/RouterOSAPI.js` (416 lines — this task ports ~200 lines covering constructor through login + close)

**Implementation:**

```typescript
import { EventEmitter } from 'events';
import createDebug from 'debug';
import { Connector } from './Connector';
import { Channel } from './Channel';
import { RosException } from './RosException';
import { md5Hash } from './md5';
import { IRosOptions } from './types';

const debugInfo = createDebug('routeros-api:api:info');
const debugError = createDebug('routeros-api:api:error');

/**
 * RouterOSAPI — main public API for connecting to and
 * communicating with MikroTik RouterOS devices.
 *
 * Ported from node-routeros RouterOSAPI.js.
 * Phase 2 delivers: connect(), login(), setOptions(), close(),
 * openChannel(), holdConnection(), releaseConnectionHold().
 * Phase 3 will add: write(), writeStream(), stream(), keepaliveBy().
 */
export class RouterOSAPI extends EventEmitter {
  private host!: string;
  private user!: string;
  private password!: string;
  private port!: number;
  private timeout!: number;
  private tls?: IRosOptions['tls'];
  private keepalive!: boolean;

  private connected = false;
  private connecting = false;
  private closing = false;

  private channelsOpen = 0;
  private holdingConnectionWithKeepalive = false;

  /** Active connection — null when disconnected */
  private connector: Connector | null = null;

  /** Timer handle for connection hold interval */
  private connectionHoldInterval: ReturnType<typeof setTimeout> | null = null;

  /** Timer handle for keepalive (Phase 3) */
  private keptaliveby: ReturnType<typeof setTimeout> | null = null;

  /** Registered RStream instances (Phase 3) */
  private registeredStreams: any[] = [];

  constructor(options: IRosOptions) {
    super();
    this.setOptions(options);
  }

  /**
   * Set connection options. Can be called before connect()
   * or before reconnecting (CONN-05).
   */
  setOptions(options: IRosOptions): void {
    this.host = options.host;
    this.user = options.user || '';
    this.password = options.password || '';
    this.port = options.port || 8728;
    this.timeout = options.timeout || 10;
    this.tls = options.tls;
    this.keepalive = options.keepalive || false;
  }

  /**
   * Connect to the RouterOS device and authenticate.
   *
   * Flow:
   *   1. Create Connector with host/port/timeout/tls options
   *   2. Wait for Connector 'connected' event
   *   3. Execute login() — MD5 challenge-response
   *   4. On success: resolve Promise with this instance
   *   5. On error/timeout: reject Promise with RosException
   *
   * @returns Promise resolving to this RouterOSAPI instance
   */
  connect(): Promise<this> {
    if (this.connecting) {
      return Promise.reject(new RosException('ALRDYCONNECTING'));
    }
    if (this.connected) {
      return Promise.resolve(this);
    }

    debugInfo('Connecting on %s', this.host);
    this.connecting = true;
    this.connected = false;

    this.connector = new Connector({
      host: this.host,
      port: this.port,
      timeout: this.timeout,
      tls: this.tls,
    });

    return new Promise((resolve, reject) => {
      // Pre-login error listener — fires on connect failure, timeout
      const endListener = (e?: Error) => {
        this.stopAllStreams();
        this.connected = false;
        this.connecting = false;
        if (e) reject(e);
      };

      this.connector!.once('error', endListener);
      this.connector!.once('timeout', endListener);
      this.connector!.once('close', () => {
        this.emit('close');
        endListener();
      });

      this.connector!.once('connected', () => {
        this.login()
          .then(() => {
            this.connecting = false;
            this.connected = true;

            // Swap error/timeout listeners to post-login behavior
            this.connector!.removeListener('error', endListener);
            this.connector!.removeListener('timeout', endListener);

            const connectedErrorListener = (e: Error) => {
              this.connected = false;
              this.connecting = false;
              this.emit('error', e);
            };
            this.connector!.once('error', connectedErrorListener);
            this.connector!.once('timeout', connectedErrorListener);

            // Start keepalive if configured (keeps session alive)
            if (this.keepalive) {
              this.keepaliveBy('#');
            }

            debugInfo('Logged in on %s', this.host);
            resolve(this);
          })
          .catch((e: Error) => {
            this.connecting = false;
            this.connected = false;
            reject(e);
          });
      });

      // Initiate the actual TCP/TLS connection
      this.connector!.connect();
    });
  }

  /**
   * Close the connection gracefully.
   * Can be re-opened via setOptions() then connect() (CONN-05).
   *
   * @returns Promise resolving when connection is fully closed
   */
  close(): Promise<this> {
    if (this.closing) {
      return Promise.reject(new RosException('ALRDYCLOSNG'));
    }
    if (!this.connected) {
      return Promise.resolve(this);
    }

    // Clear hold + keepalive timers
    if (this.connectionHoldInterval) {
      clearTimeout(this.connectionHoldInterval);
      this.connectionHoldInterval = null;
    }
    if (this.keptaliveby) {
      clearTimeout(this.keptaliveby);
      this.keptaliveby = null;
    }
    this.stopAllStreams();

    return new Promise((resolve) => {
      this.closing = true;
      this.connector!.once('close', () => {
        this.connector!.destroy();
        this.connector = null;
        this.closing = false;
        this.connected = false;
        resolve(this);
      });
      this.connector!.close();
    });
  }

  /**
   * Open a new tagged channel for a command.
   * Used internally by write() (Phase 3).
   */
  openChannel(): Channel {
    this.increaseChannelsOpen();
    return new Channel(this.connector!);
  }

  // ──── Private methods ────

  /**
   * Authenticate with RouterOS using MD5 challenge-response.
   *
   * RouterOS v6.43+ login flow:
   *   1. Send /login with name and password directly
   *   2. If response length === 0 → credentials accepted (fast path)
   *   3. If response length === 1 with 'ret' field → challenge received
   *      - Build challenge buffer: [0x00] + password bytes + challenge hex bytes
   *      - MD5 hash the buffer → '00' + lowercase hex digest
   *      - Send /login with name and response
   *   4. If login fails with known messages → CANTLOGIN
   *
   * PITFALLS.md #2: MD5 challenge must operate on raw bytes, not strings.
   * The challenge buffer is: 0x00 + password (Latin-1 bytes) + challenge (hex-decoded to 16 bytes).
   */
  private login(): Promise<this> {
    this.connecting = true;
    debugInfo('Sending 6.43+ login to %s', this.host);

    // Step 1: Send initial login with plain password
    // Uses openChannel() + Channel.write() for the command
    return this.write('/login', [
      `=name=${this.user}`,
      `=password=${this.password}`,
    ])
      .then((data) => {
        if (data.length === 0) {
          // Fast path — RouterOS v6.43+ accepted credentials directly
          debugInfo(
            '6.43+ Credentials accepted on %s, we are connected',
            this.host
          );
          return Promise.resolve(this);
        } else if (data.length === 1) {
          // Challenge received — construct MD5 response
          debugInfo(
            'Received challenge on %s, will send credentials. Data: %o',
            this.host,
            data
          );

          const challengeHex: string = (data[0] as any).ret;
          if (!challengeHex || challengeHex.length !== 32) {
            return Promise.reject(
              new RosException('CANTLOGIN', {
                message: 'Invalid challenge received from router',
              })
            );
          }

          // Build the challenge buffer:
          // Layout: [0x00][password bytes][16 bytes of challenge]
          const passwordBytes = this.encodeLatin1(this.password);
          const challengeBytes = this.hexToBytes(challengeHex);

          const challenge = new Uint8Array(
            1 + passwordBytes.length + challengeBytes.length
          );
          challenge[0] = 0x00; // null byte
          challenge.set(passwordBytes, 1);
          challenge.set(challengeBytes, 1 + passwordBytes.length);

          // MD5 hash (Phase 1 md5Hash accepts Uint8Array)
          const resp = '00' + md5Hash(challenge);

          // Step 3: Send response login
          return this.write('/login', [
            '=name=' + this.user,
            '=response=' + resp,
          ])
            .then(() => {
              debugInfo(
                'Credentials accepted on %s, we are connected',
                this.host
              );
              return Promise.resolve(this);
            })
            .catch((err) => {
              if (
                err.message === 'cannot log in' ||
                err.message === 'invalid user name or password (6)'
              ) {
                err = new RosException('CANTLOGIN');
              }
              this.connector!.destroy();
              debugError(
                "Couldn't log in to %s, Error: %O",
                this.host,
                err
              );
              return Promise.reject(err);
            });
        }

        // Unknown response from /login
        debugError(
          'Unknown return from /login command on %s, data returned: %O',
          this.host,
          data
        );
        return Promise.reject(new RosException('CANTLOGIN'));
      })
      .catch((err) => {
        if (
          err.message === 'cannot log in' ||
          err.message === 'invalid user name or password (6)'
        ) {
          err = new RosException('CANTLOGIN');
        }
        if (this.connector) {
          this.connector.destroy();
        }
        debugError("Couldn't log in to %s, Error: %O", this.host, err);
        return Promise.reject(err);
      });
  }

  /**
   * Write a command and return a Promise with the response.
   * Minimal implementation for login() — Phase 3 will expand this
   * to handle multiple params, writeStream, stream, keepalive.
   *
   * @param command   RouterOS command path (e.g., '/login')
   * @param params    Array of parameter strings
   * @returns         Promise resolving with parsed response data
   */
  private write(command: string, params: string[]): Promise<Record<string, any>[]> {
    const chann = this.openChannel();
    this.holdConnection();

    chann.once('close', () => {
      this.decreaseChannelsOpen();
      this.releaseConnectionHold();
    });

    return chann.write([command, ...params]) as Promise<Record<string, any>[]>;
  }

  // ──── Channel bookkeeping (verbatim from original) ────

  private increaseChannelsOpen(): void {
    this.channelsOpen++;
  }

  private decreaseChannelsOpen(): void {
    this.channelsOpen--;
  }

  private registerStream(stream: any): void {
    this.registeredStreams.push(stream);
  }

  private unregisterStream(stream: any): void {
    this.registeredStreams = this.registeredStreams.filter(
      (s) => s !== stream
    );
  }

  private stopAllStreams(): void {
    for (const stream of this.registeredStreams) {
      stream.stop();
    }
  }

  // ──── Connection hold (verbatim from original) ────

  /**
   * Hold the connection open while channels are active.
   * Sends a dummy '#' command at (timeout / 2) intervals to
   * prevent RouterOS from timing out the session.
   */
  private holdConnection(): void {
    if (this.channelsOpen !== 1) return;
    if (this.connected && !this.holdingConnectionWithKeepalive) {
      if (this.connectionHoldInterval) {
        clearTimeout(this.connectionHoldInterval);
      }
      const holdConnInterval = () => {
        this.connectionHoldInterval = setTimeout(() => {
          let chann: Channel | null = new Channel(this.connector!);
          chann.on('close', () => {
            chann = null;
          });
          chann
            .write(['#'])
            .then(() => {
              holdConnInterval();
            })
            .catch(() => {
              holdConnInterval();
            });
        }, (this.timeout * 1000) / 2);
      };
      holdConnInterval();
    }
  }

  private releaseConnectionHold(): void {
    if (this.channelsOpen > 0) return;
    if (this.connectionHoldInterval) {
      clearTimeout(this.connectionHoldInterval);
      this.connectionHoldInterval = null;
    }
  }

  // ──── Keepalive (stub for Phase 3; enough for connect()) ────

  private keepaliveBy(params: string = '#'): void {
    this.holdingConnectionWithKeepalive = true;
    if (this.keptaliveby) {
      clearTimeout(this.keptaliveby);
    }
    const exec = () => {
      if (!this.closing) {
        if (this.keptaliveby) clearTimeout(this.keptaliveby);
        this.keptaliveby = setTimeout(() => {
          this.write(params, [])
            .then(() => exec())
            .catch(() => exec());
        }, (this.timeout * 1000) / 2);
      }
    };
    exec();
  }

  // ──── Encoding helpers for MD5 challenge ────

  /**
   * Encode a string to Latin-1 (ISO 8859-1) bytes.
   * RouterOS passwords in the MD5 challenge use Latin-1, not UTF-8.
   * This matches the original Buffer.write(String.fromCharCode(0) + password)
   * behavior — Buffer.write with no encoding defaults to Latin-1.
   *
   * PITFALLS.md #2: Using UTF-8 for password bytes produces wrong MD5 hash.
   */
  private encodeLatin1(str: string): Uint8Array {
    const bytes = new Uint8Array(str.length);
    for (let i = 0; i < str.length; i++) {
      bytes[i] = str.charCodeAt(i) & 0xff; // Latin-1: truncate to byte
    }
    return bytes;
  }

  /**
   * Convert a hex string (32 chars = 16 bytes) to Uint8Array.
   * Used to decode the challenge 'ret' value from RouterOS.
   */
  private hexToBytes(hex: string): Uint8Array {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
    }
    return bytes;
  }
}
```

**Key RN adaptations:**
1. `crypto.createHash('MD5').update(challenge).digest('hex')` → `md5Hash(challenge)` from Phase 1
2. `Buffer.alloc(password.length + 17)` → `new Uint8Array(1 + passwordBytes.length + challengeBytes.length)`
3. `challenge.write(String.fromCharCode(0) + password)` → explicit `challenge[0] = 0x00; challenge.set(passwordBytes, 1)`
4. `challenge.write(ret, offset, ret.length/2, 'hex')` → `challenge.set(challengeBytes, offset)` (pre-decoded via `hexToBytes()`)
5. Response format: `'00' + md5Hash(challenge)` — identical to original `'00' + crypto.createHash('MD5').update(challenge).digest('hex')`

**Pitfall mitigations:**
- PITFALLS.md #2 (MD5 byte encoding): `encodeLatin1()` ensures password bytes are Latin-1, not UTF-8. `hexToBytes()` correctly decodes the 32-char hex challenge string into 16 bytes. The challenge buffer layout `[0x00][password][challenge]` matches the original exactly.
- PITFALLS.md #14 (Hermes no Buffer): All byte arrays are `Uint8Array`. No `Buffer` usage anywhere.
- `login()` three paths preserved: fast path (0 results), challenge path (1 result with `.ret`), failure path (catch → CANTLOGIN).
- Error messages matched: `'cannot log in'` and `'invalid user name or password (6)'` — exact strings from original.

Read first: `node-routeros/dist/RouterOSAPI.js` lines 1-122 (constructor, setOptions, connect), 345-402 (login), 244-267 (close), 273-337 (channel bookkeeping + connection hold). PITFALLS.md #2 (MD5 challenge), #14 (Buffer in Hermes).
  </action>
  <verify>
    <automated>
# Verify RouterOSAPI structure and login flow
node -e "
const fs = require('fs');
const content = fs.readFileSync('./src/RouterOSAPI.ts', 'utf8');
console.log('RouterOSAPI class exported:', content.includes('export class RouterOSAPI'));
console.log('Extends EventEmitter:', content.includes('extends EventEmitter'));
console.log('Has setOptions():', content.includes('setOptions('));
console.log('Has connect():', content.includes('connect()'));
console.log('Has login():', content.includes('private login()'));
console.log('Has close():', content.includes('close()'));
console.log('Has openChannel():', content.includes('openChannel()'));
console.log('Has private write():', content.includes('private write('));
// MD5 challenge
console.log('Uses md5Hash:', content.includes('md5Hash'));
console.log('encodeLatin1:', content.includes('encodeLatin1'));
console.log('hexToBytes:', content.includes('hexToBytes'));
console.log('Challenge buffer:', content.includes(\"0x00\"));
console.log('Response format 00+:', content.includes(\"'00' + md5Hash\"));
// Auth error handling
console.log('CANTLOGIN handling:', content.includes('CANTLOGIN'));
console.log('cannot log in check:', content.includes('cannot log in'));
console.log('invalid user name check:', content.includes('invalid user name or password'));
// Flags
console.log('connected/connecting/closing flags:', content.includes('private connected') && content.includes('private connecting') && content.includes('private closing'));
// Connection hold
console.log('holdConnection:', content.includes('holdConnection()'));
console.log('releaseConnectionHold:', content.includes('releaseConnectionHold()'));
// Channel bookkeeping
console.log('channelsOpen:', content.includes('channelsOpen'));
// Event wiring
console.log('ALRDYCONNECTING guard:', content.includes('ALRDYCONNECTING'));
console.log('ALRDYCLOSNG guard:', content.includes('ALRDYCLOSNG'));
// Zero Node.js
console.log('NO crypto import:', !content.includes(\"from 'crypto'\") && !content.includes('require(\"crypto\")'));
console.log('NO Buffer.alloc:', !content.includes('Buffer.alloc'));
console.log('NO timers import:', !content.includes(\"from 'timers'\") && !content.includes('require(\"timers\")'));
// Debug namespaces
console.log('Debug namespaces:', content.includes('routeros-api:api'));
"
    </automated>
  </verify>
  <done>
- `src/RouterOSAPI.ts` compiles as part of full `tsc --noEmit` (verified in Task 8)
- `setOptions(options)` stores host, user, password, port (default 8728), timeout (default 10), tls, keepalive
- `connect()` guards on `connecting`/`connected` → returns rejected/resolved Promise appropriately
- `connect()` creates Connector, wires pre-login error/timeout/close listeners, initiates connection
- On Connector 'connected' → calls `login()` → on success swaps listeners, starts keepalive if configured, resolves
- On Connector 'error'/'timeout'/'close' → cleans up and rejects (ERR-03: socket-level errors)
- `login()` sends `/login` with plain credentials → handles 3 paths:
  1. 0 results → fast path, resolve (AUTH-01, AUTH-02)
  2. 1 result with `.ret` → MD5 challenge → build `[0x00][password][challenge]` buffer → `md5Hash()` → send `/login` with `=response=00<hex>`
  3. Catch → convert "cannot log in" / "invalid user name or password (6)" → `RosException('CANTLOGIN')` (AUTH-03)
- `encodeLatin1()` → Latin-1 byte encoding for password (PITFALLS.md #2 — not UTF-8)
- `hexToBytes()` → hex string → 16-byte Uint8Array for challenge
- `close()` destroys connector, resets flags, allows reconnect via `setOptions()` + `connect()` (CONN-04, CONN-05)
- `openChannel()` creates new Channel with incremented channel counter
- `holdConnection()` / `releaseConnectionHold()` — keeps session alive during active channels
- Connection hold interval = `(timeout * 1000) / 2` — identical to original
- Zero Node.js imports: no `crypto`, no `timers` (uses global `clearTimeout`/`setTimeout`), no `Buffer`
- Debug namespace preserved: `routeros-api:api:info` / `:error`
  </done>
</task>

<!-- ============================================================ -->
<!-- WAVE 4: Barrel Update + Full Verification                     -->
<!-- ============================================================ -->

<!-- ============== TASK 8: Barrel Update + Compilation ============== -->
<task type="tracer">
  <name>Update barrel export and verify full compilation</name>
  <files>src/index.ts</files>
  <action>
Update `src/index.ts` to include all Phase 2 modules alongside the Phase 1 modules.

**Current `src/index.ts` (from Phase 1):**
```typescript
export { IRosOptions, type TlsRnOptions } from './types';
export { IRosGenericResponse } from './types';
export { default as messages } from './messages';
export { RosException } from './RosException';
export { decodeWin1252, encodeWin1252 } from './win1252';
export { debounce } from './utils';
export { md5Hash } from './md5';
```

**Updated `src/index.ts` (Phase 2 additions at the bottom):**
```typescript
// Phase 1: Foundation
export { IRosOptions, type TlsRnOptions } from './types';
export { IRosGenericResponse } from './types';
export { default as messages } from './messages';
export { RosException } from './RosException';
export { decodeWin1252, encodeWin1252 } from './win1252';
export { debounce } from './utils';
export { md5Hash } from './md5';

// Phase 2: Protocol + Connection
export { createPlainSocket, createTlsSocket } from './transport/SocketAdapter';
export type { RosSocket } from './transport/SocketAdapter';
export { Transmitter } from './Transmitter';
export { Receiver } from './Receiver';
export { Connector } from './Connector';
export type { ConnectorOptions } from './Connector';
export { Channel } from './Channel';
export { RouterOSAPI } from './RouterOSAPI';
```

After editing, run `npx tsc --noEmit` as the final gate. Must pass with zero errors.

**Verify import chain integrity:**
- `RouterOSAPI` → `Connector` + `Channel` + `RosException` + `md5Hash` + `types`
- `Connector` → `SocketAdapter` + `Transmitter` + `Receiver` + `RosException`
- `Channel` → `RosException` + `Connector` (type-only for interface)
- `Transmitter` → `win1252` (encodeWin1252)
- `Receiver` → `win1252` (decodeWin1252) + `RosException`
- `SocketAdapter` → `types` (TlsRnOptions)
- All Phase 1 modules are imported by their Phase 2 dependents via the original `./` paths (not through index.ts barrel — avoids circular imports)

**Key integration checks:**
1. `RouterOSAPI` constructor accepts `IRosOptions` (TYPE-02)
2. `Connector` constructor accepts `ConnectorOptions` (host, port, timeout, tls)
3. `SocketAdapter` factory functions take `{host, port, timeout, tls}` matching ConnectorOptions
4. `RosSocket` type resolves to `TcpSocket` from react-native-tcp-socket
5. `Transmitter` / `Receiver` accept `RosSocket` in their constructors
6. `Channel` constructor accepts `Connector` reference
7. No circular imports (all imports point to direct file paths, not barrel index)
8. No Node.js runtime imports anywhere in the dependency tree

Run `npx tsc --noEmit` to verify everything.

Read first: `src/index.ts` (current state — the barrel from Phase 1), `node-routeros/dist/index.d.ts` (original public exports).
  </action>
  <verify>
    <automated>npx tsc --noEmit</automated>
  </verify>
  <done>
- `npx tsc --noEmit` exits 0 with zero errors across all Phase 1 + Phase 2 modules
- `src/index.ts` barrel exports all 14+ symbols: Phase 1 types/interfaces + Phase 2 classes/functions
- Every public API type is importable from `src/index.ts`
- Zero Node.js runtime API usage anywhere in the dependency tree
- Import chain is acyclic — all imports are direct file paths, not barrel-re-exports
- `RouterOSAPI` is the top-level consumer entry point — connect, login, close, setOptions
- `Connector`, `Transmitter`, `Receiver`, `Channel`, `SocketAdapter` are exported for advanced usage
- `RosSocket` type exported for consumers who need to mock or extend the transport layer
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description | Affected Components |
|----------|-------------|---------------------|
| **Network (TCP/TLS)** | Raw socket data from RouterOS device — may be malformed, incomplete, or malicious | Receiver, Connector |
| **Authentication** | Username/password sent over the wire; MD5 challenge-response | RouterOSAPI.login() |
| **TLS Certificate** | Self-signed RouterOS certificates — consumer provides `ca` via TlsRnOptions | SocketAdapter |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-02-01 | Spoofing | SocketAdapter (TLS) | HIGH | mitigate | `ca` option validates server certificate if provided; self-signed certs accepted per RouterOS convention — consumer must provide CA pem |
| T-02-02 | Tampering | Receiver.processRawData() | MEDIUM | mitigate | `decodeLength()` validates length descriptor bytes; malformed lengths produce incorrect parsing → UNREGISTEREDTAG → consumer error |
| T-02-03 | Information Disclosure | RouterOSAPI.login() | MEDIUM | accept | Password sent as MD5 challenge-response (not plaintext) for RouterOS v6.43+; initial /login may send plaintext for v6.0-6.42 — this is the RouterOS protocol, not a library choice |
| T-02-04 | Denial of Service | Receiver | LOW | accept | Large or infinite data from socket → memory growth in sentencePipe/currentLine/currentPacket; bounded by RouterOS protocol limits (max word ~2GB theoretical, practical sentences are small) |
| T-02-05 | Elevation of Privilege | Connector.connect() | LOW | accept | Guard flags (connecting/connected) prevent double-connect; no authentication bypass — login() always required after connection |
| T-02-06 | Spoofing | Channel tag generation | LOW | accept | `Math.random().toString(36)` is not cryptographically random — duplicate tags across short-lived channels are statistically improbable but not impossible; original node-routeros has same behavior |
</threat_model>

<verification>
- [ ] `npm install` completes with react-native-tcp-socket@^6.4.2, events@^3.3.0, debug@^4.4.3, @types/debug@^4.1
- [ ] `npx tsc --noEmit` passes with strict:true, zero errors — all 8 modules compile
- [ ] `SocketAdapter.createPlainSocket()` returns socket with `data`/`error`/`close`/`timeout` events and `write`/`destroy`/`end`/`setTimeout` methods
- [ ] `SocketAdapter.createTlsSocket()` maps `TlsRnOptions` → RN-TCP `TlsOptions` without `tlsClientError`
- [ ] `Transmitter.encodeString(null)` returns `Uint8Array([0x00])` — sentence terminator
- [ ] `Transmitter.encodeString(str)` produces length-prefixed win1252-encoded frames
- [ ] `Receiver.decodeLength()` handles all 5 RouterOS length-encoding branches
- [ ] `Receiver.processRawData()` parses multi-word sentences, handles chunk boundaries, routes by `.tag=`
- [ ] `Receiver` emits `socket.emit('fatal')` on `!fatal` replies (→ Connector.onEnd → close)
- [ ] `Connector.connect()` blocks on `connected`/`connecting` flags, creates socket via SocketAdapter, wires events
- [ ] `Connector` has zero `tlsClientError` event wiring, uses `'close'` not `'end'`
- [ ] `Connector.onError()` wraps raw errors in RosException with errno (ECONNREFUSED, SOCKTMOUT)
- [ ] `Channel.write(params)` appends `.tag=<id>`, returns Promise, resolves on `!done`, rejects on `!trap`
- [ ] `RouterOSAPI.connect()` returns Promise, wires pre-login error/timeout listeners, calls login()
- [ ] `RouterOSAPI.login()` handles fast path (0 results), challenge path (1 result with .ret), failure path (CANTLOGIN)
- [ ] MD5 challenge buffer: `[0x00][password Latin-1 bytes][16 challenge bytes]` → `md5Hash()` → `'00' + hex`
- [ ] `RouterOSAPI.close()` destroys connector, resets flags, enables reconnect via `setOptions()` + `connect()` (CONN-05)
- [ ] `src/index.ts` barrel exports all 14+ symbols from both Phase 1 and Phase 2
- [ ] Zero Node.js runtime imports anywhere in the dependency tree (no `net`, `tls`, `crypto`, `buffer`, `iconv-lite`, `timers`)
- [ ] All 10 Phase 2 requirements addressed: CONN-01..05, AUTH-01..03, ERR-01, ERR-03
</verification>

<success_criteria>
- [ ] `npx tsc --noEmit` passes — zero errors, strict mode
- [ ] All 10 Phase 2 requirements satisfied:
  - CONN-01: Plain TCP connection on port 8728 via SocketAdapter.createPlainSocket
  - CONN-02: TLS connection on port 8729 via SocketAdapter.createTlsSocket (self-signed certs via `ca`)
  - CONN-03: Connection options (host, port, timeout, tls) configurable via IRosOptions / ConnectorOptions
  - CONN-04: Graceful close via RouterOSAPI.close() → Connector.close() → socket.end()
  - CONN-05: Reconnect via setOptions() then connect() on same RouterOSAPI instance
  - AUTH-01: MD5 challenge-response login against RouterOS v6 (fast path + challenge path)
  - AUTH-02: Same login flow works for RouterOS v7
  - AUTH-03: Failed login → RosException('CANTLOGIN') with clear message
  - ERR-01: !trap errors → RosException via Channel Promise rejection → RouterOSAPI login catch
  - ERR-03: Socket errors (ECONNREFUSED, SOCKTMOUT, TLS failure) → RosException with correct errno
- [ ] Full connect → login → close lifecycle works end-to-end (real RouterOS device test encouraged)
- [ ] SocketAdapter + Connector pattern re-connectable without re-instantiating RouterOSAPI
- [ ] Zero Node.js runtime API usage — RN-compatible from day one
- [ ] All existing Phase 1 modules still compile and work (no regressions)
</success_criteria>

<output>
Create `.planning/phases/02-protocol-connection/02-SUMMARY.md` when done
</output>

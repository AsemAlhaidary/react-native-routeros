# Project Research Summary — react-native-routeros

**Synthesized:** 2026-08-10
**Source files:** STACK.md, FEATURES.md, ARCHITECTURE.md, PITFALLS.md
**Overall confidence:** HIGH

---

## Executive Summary

**react-native-routeros** is a ground-up React Native port of the archived `node-routeros` v1.6.8 library (MIT), providing a pure-TypeScript MikroTik RouterOS API client that works in Bare React Native and Expo (custom dev client). This is a **greenfield opportunity** — no existing React Native RouterOS library exists. Users today must run a Node.js proxy server or REST API middleware. This library eliminates that infrastructure by talking directly to RouterOS over TCP port 8728 (plain) or 8729 (TLS).

**The porting approach is high-confidence:** 80% of the original codebase ports verbatim. Only three isolated layers need replacement — transport (`net`/`tls` → `react-native-tcp-socket`), encoding (`iconv-lite` → custom win1252 lookup table), and crypto (`crypto.MD5` → `js-md5`). The original library has a clean separation between protocol logic and platform dependencies, making the migration predictable. Total runtime dependencies are just 4 packages (~50KB gzipped), with a zero-dependency custom win1252 codec (~1.5KB). TypeScript strict mode, builder-bob builds, and an Expo config plugin ship from day one.

**The key risks are protocol-level correctness, not architecture.** The MD5 challenge-response login operates on raw bytes — a single byte-off encoding produces wrong hashes and silent auth failures. The win1252 codec must exactly match `iconv-lite` output or RouterOS commands silently corrupt. The `0x00` null byte terminator in RouterOS sentences must never appear in encoded content. These are all **deterministic, testable risks** — each has a clear prevention strategy (test vectors, fuzz testing, fenced validation). The highest operational risk is that Android blocks plain-TCP on port 8728 (cleartext policy) and iOS/Android background the app killing TCP sockets — both have platform-specific mitigations.

---

## Key Findings

### Stack

**4 runtime dependencies, everything else is build-only or inline:**

| Dependency | Purpose | Why This One |
|------------|---------|-------------|
| `react-native-tcp-socket` ^6.4.2 | Raw TCP + TLS transport | Mirrors Node `net`/`tls` API exactly; actively maintained; only viable raw-TCP native module for RN |
| `js-md5` ^0.9.2 | MD5 challenge-response login | Native `Uint8Array`/`ArrayBuffer` support (critical for byte-level hashing); zero deps; built-in TS types |
| `events` ^3.3.0 | EventEmitter base class | Node 11.13.0-compatible; RN's built-in EventEmitter is deprecated and has a different API |
| `debug` ^4.4.3 | Namespaced debug logging | Same as original dependency; browser/RN-compatible; `DEBUG=routeros:*` convention |

**Zero-dependency win1252 codec** — a 128-byte static lookup table plus two small functions (`encodeWin1252`/`decodeWin1252`). Totals ~1.5KB minified. Windows-1252 is identical to ASCII for 0x00–0x7F; only 27 code points differ from ISO-8859-1 in 0x80–0x9F. This replaces `iconv-lite` (~130KB, Node-centric). **Confidence: HIGH.**

**Build tooling:** TypeScript ~5.9.0 (not 7.0 — RN ecosystem lags), `react-native-builder-bob` ^0.43.0 for CJS/ESM dual-output, Expo config plugin for CNG compatibility marker.

**Rejected:** `spark-md5` (no built-in TS types, last published 5 years ago), `iconv-lite` (Node-centric, ~130KB), `crypto-js` (~400KB, overkill), `expo-module-scripts` (over-commits to Expo ecosystem), any Node built-in (`net`, `tls`, `crypto`, `Buffer`, `stream`).

### Features

**16 table-stakes features** (full node-routeros v1.6.8 API parity) — `connect()` with MD5 challenge-response, `write()` one-shot commands, `writeStream()` evented commands, `stream()` continuous data with pause/resume/stop, `close()` graceful disconnect, `keepaliveBy()` idle prevention, `setOptions()` reconfiguration, connection events, `RosException` with errno-keyed messages, TypeScript types, win1252 encoding, Bare RN + Expo support, README, Channel/tag management, and Receiver protocol parser. The API surface is identical to node-routeros by design — existing users migrate by changing their import.

**6 differentiators:** (1) First-to-market RN RouterOS library — no alternatives exist; (2) Zero Node.js runtime dependency — everything is RN-native or pure-JS; (3) Identical API to node-routeros for frictionless migration; (4) Expo config plugin for one-command setup; (5) Self-signed cert TLS as the happy path (MikroTik default); (6) Pure-TypeScript source that users can inspect and contribute to.

**8 anti-features deliberately excluded:** Expo Go compatibility (raw TCP needs native module), RouterOS REST API transport (separate protocol, users can use `fetch()`), WebSocket transport, high-level OOP wrapper (`routeros-client` — separate package later), SSH transport, bundled CA certificates (security maintenance burden), GitHub/npm publishing in v1, React hooks API (`useRouterOS` — separate package later).

**Feature dependency layers** impose build order: Foundation (win1252, MD5, transport) → Protocol (Receiver parser) → Core API (connect, Channel, close, events, errors) → Commands + Streaming (write, writeStream, stream, keepalive) → Developer Experience (types, docs, Expo plugin).

### Architecture

**80% of the original node-routeros codebase ports verbatim.** The protocol core (Receiver, Transmitter, Channel, RStream) and API orchestration (RouterOSAPI) contain zero Node-specific logic beyond their imports. Only three isolated replacements are needed, all well-scoped and testable:

1. **Transport** (`net`/`tls` → `react-native-tcp-socket`): Socket API is highly compatible. The only material differences are factory creation (`TcpSocket.createConnection()` vs `new net.Socket()`), separate TLS method (`connectTLS()`), TLS certs via `require()` not file paths, and no `tlsClientError` event (TLS errors surface as regular `'error'` events — already handled). A thin `SocketAdapter` (~80 LOC) wraps both plain and TLS creation.

2. **Encoding** (`iconv-lite` → custom win1252): A static 256-entry lookup table for decode, reverse map for encode. ~50 LOC TypeScript. Exact behavior verifiable against original `iconv-lite` output via fuzz testing.

3. **Crypto** (`crypto.MD5` → `js-md5`): Only used in one place — login challenge-response on inputs <128 bytes. `js-md5` accepts `Uint8Array` directly.

The `socket.emit('fatal')` in the original is **custom code, not a Node API** — it works identically on any EventEmitter. RN timers work globally — just drop the `import { clearTimeout } from 'timers'`.

**Build order (5 waves):**
- **Wave 0** (Foundation): messages, RosException, utils, types, win1252 — all independent, all parallel
- **Wave 1** (Transport): SocketAdapter — thin wrapper around react-native-tcp-socket
- **Wave 2** (Protocol Core): Transmitter + Receiver — ported with win1252 codec swapped in; built in parallel
- **Wave 3** (API Layer): Channel (interface), Connector, md5 in parallel; then RStream (depends on Channel)
- **Wave 4** (Integration): RouterOSAPI, barrel exports (index.ts)

Total estimated code: ~1,600 LOC TypeScript (original is ~1,200 LOC JS; increase from type annotations + 3 replacement modules).

### Pitfalls

**18 identified pitfalls** (4 CRITICAL, 5 HIGH, 6 MEDIUM, 3 LOW):

**CRITICAL (must prevent — these silently break the protocol):**
1. **MD5 challenge byte-level encoding** — the login hash operates on raw bytes `[0x00][password_bytes][16_bytes_challenge]`. Using string-based MD5 or wrong encoding produces wrong hashes. Prevent with test vectors captured from real RouterOS.
2. **win1252 wrong byte handling** — the 0x80–0x9F range differs from Latin-1 in 27 code points. A wrong mapping silently corrupts commands. Prevent with static lookup table + fuzz test against iconv-lite output.
3. **0x00 null byte collision** — RouterOS uses `0x00` as sentence terminator. If encoded content contains `0x00`, the router truncates the command. Prevent by validating no 0x00 in encoded words and sanitizing inputs.
4. **react-native-tcp-socket API mismatch** — `socket.on('end')` never fires (use `'close'`), `tls.connect()` doesn't exist (use `connectTLS()`), TLS errors surface differently. Prevent with SocketAdapter abstraction + tests on both platforms.

**HIGH (will cause operational failures):**
5. Socket destroyed during write (TOCTOU race on Android)
6. RN app backgrounding kills TCP sockets silently
7. Android blocks plain-TCP port 8728 (cleartext policy)
8. TLS self-signed cert handling differs iOS vs Android
9. `!fatal` termination not distinguished from `!trap` (keeps trying dead socket)

**Phase coverage:** Most pitfalls map to specific phases. Phase 2 (socket layer) carries the highest concentration of risks. Phase 4 (encoding) has the protocol-critical correctness risks. Phase 5 (robustness) handles lifecycle issues.

---

## Implications for Roadmap

Based on combined feature dependencies, architecture build waves, and pitfall phase mapping, the recommended phase structure is:

### Phase 1: Foundation + Protocol Core
**Rationale:** Everything downstream depends on win1252 codec and the Receiver protocol parser. These are the most testable components in isolation — verify correctness with unit tests and fuzz tests before touching real sockets.

**Delivers:** messages.ts, RosException.ts, utils.ts, types.ts, win1252.ts, Transmitter.ts, Receiver.ts

**Features from FEATURES.md:** F10 (RosException), F12 (win1252), F16 (Receiver), foundational types for F11

**Pitfalls to avoid:** #3 (win1252 byte handling), #4 (0x00 null byte), #17 (out-of-range chars)

### Phase 2: Transport + Connection
**Rationale:** Wire the real TCP socket transport. This is where platform-specific behavior matters most (TLS on iOS vs Android, cleartext policy, socket lifecycle). The connect → login → write flow must work end-to-end. This is a natural milestone.

**Delivers:** SocketAdapter.ts, Connector.ts, Channel.ts, md5.ts, RouterOSAPI.ts (connect/login only)

**Features from FEATURES.md:** F1 (constructor), F2 (connect with MD5 login), F6 (close), F8 (setOptions), F9 (connection events), F15 (Channel)

**Pitfalls to avoid:** #1 (API mismatch), #5 (TOCTOU write race), #7 (Android cleartext), #8 (TLS cross-platform), #2 (MD5 byte encoding), #10 (tag collision), #18 (double-connect listeners)

### Phase 3: Commands + Streaming
**Rationale:** Build the full command surface on top of a working connect/login/write foundation. RStream depends on Channel which is ready from Phase 2. Streaming behavior (pause/resume/stop) interacts with RN timer behavior — needs platform verification.

**Delivers:** RStream.ts, RouterOSAPI.ts (write, writeStream, stream, keepaliveBy), index.ts

**Features from FEATURES.md:** F3 (write), F4 (writeStream), F5 (stream), F7 (keepaliveBy)

**Pitfalls to avoid:** #16 (v7.18+ `!empty` reply), RStream pause/resume timer behavior

### Phase 4: Robustness + Lifecycle
**Rationale:** Production-hardening. App backgrounding, `!fatal` handling, reconnection logic. These are cross-cutting concerns that apply to all phases but are best addressed after the core API works.

**Delivers:** AppState listener, reconnection logic, `!fatal` event chain hardening, error recovery

**Features from FEATURES.md:** Cross-cutting improvements to all existing features

**Pitfalls to avoid:** #6 (backgrounding kills sockets), #9 (!fatal vs !trap), #2 (reconnect MD5)

### Phase 5: Build, Types, Docs + Expo Plugin
**Rationale:** Tooling and developer experience. These have no code dependencies on earlier phases and can parallelize most work. The Expo plugin needs Android manifest modifications tested.

**Delivers:** package.json (with builder-bob + exports config), tsconfig.json, generated .d.ts, README with examples, Expo config plugin, .gitignore

**Features from FEATURES.md:** F11 (TypeScript types), F13 (Bare RN + Expo support), F14 (README), D4 (Expo config plugin)

**Pitfalls to avoid:** #11 (CJS/ESM dual-output), #12 (missing .d.ts), #13 (missing peerDependencies), #15 (Expo plugin auto-link), #7 (cleartext in plugin)

### Research Flags

| Phase | Research Need | Rationale |
|-------|--------------|-----------|
| **Phase 2** | **HIGH — needs research** | TLS cert loading model differs iOS vs Android. Self-signed cert workflow must be verified on both platforms. MD5 challenge-response must match RouterOS byte-level format exactly. Likely needs `/gsd-plan-phase --research-phase 2`. |
| **Phase 3** | **MEDIUM — needs research** | RStream pause/resume creates temp Channels; RN timer behavior may differ from Node. Verify with real RouterOS listen/torch commands. |
| **Phase 1** | **LOW — standard patterns** | win1252 lookup table is a well-documented standard. fuzz-test against iconv-lite is straightforward. |
| **Phase 4** | **LOW — standard patterns** | AppState listener is documented RN pattern. reconnect logic follows standard exponential backoff patterns. |
| **Phase 5** | **LOW — standard patterns** | builder-bob config is documented. Expo config plugin follows published patterns. |

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|-----------|-------|
| **Stack** | **HIGH** | All dependencies verified against npm (versions, APIs, maintenance status). React-native-tcp-socket confirmed actively maintained (published 15 days ago). js-md5 confirmed Uint8Array support. win1252 codec is a well-documented standard. |
| **Features** | **HIGH** | Direct analysis of node-routeros v1.6.8 compiled `dist/` code. Full API surface catalogued. Feature dependencies mapped from source code, not documentation. Anti-features explicitly bounded per PROJECT.md. |
| **Architecture** | **HIGH** | Component-level dependency graph extracted from source code analysis. 80% verbatim port validated. Three replacement layers identified and scoped. socket.emit('fatal') confirmed as custom code, not Node API. Build wave parallelism verified. |
| **Pitfalls** | **HIGH** | 18 pitfalls identified from source code analysis + react-native-tcp-socket issue tracker + MikroTik API protocol documentation. Each pitfall has a concrete prevention strategy. Phase-specific warnings mapped. |

### Gaps to Address

1. **RouterOS v7.18+ `!empty` reply** — mentioned in pitfalls (#16) but not verified against a real v7.18+ router. The node-routeros codebase predates this protocol change. Needs validation during Phase 3 testing.

2. **Hermes engine edge cases** — Pitfall #14 flags that Hermes lacks `Buffer` and `crypto` globals. The stack plan avoids Buffer entirely (Uint8Array + DataView), but subtle Hermes-specific JIT behavior around typed arrays needs verification. Low risk but worth a test pass.

3. **react-native-tcp-socket iOS background behavior** — Issue #215 in their tracker mentions backgrounding issues. The robustness phase (Phase 4) handles this with AppState listeners, but the exact behavior on iOS 17+ needs platform testing.

4. **RouterOS v6 vs v7 login flow differences** — Both versions are handled by node-routeros (fast-path for v6.43+), but the `!empty` reply in v7.18+ during login needs specific testing.

5. **Actual RouterOS test instance** — The MD5 test vector (#2 prevention) requires capturing intermediate challenge/response bytes from a real RouterOS instance. This cannot be synthesized; it needs a real router or emulator (CHR/MikroTik Cloud Hosted Router).

---

## Sources

- node-routeros v1.6.8 compiled `dist/` analysis — RouterOSAPI.js, Connector.js, Transmitter.js, Receiver.js, Channel.js, RStream.js, RosException.js, messages.js, utils.js
- PROJECT.md — explicit requirements: full API parity, RN socket choice, out-of-scope items
- react-native-tcp-socket v6.4.2 README + closed issues — TCP/TLS API surface, known issues (#233 write crash, #215 iOS backgrounding, #201 connect timeout)
- js-md5 v0.9.2 npm page — Uint8Array/ArrayBuffer support confirmed
- events v3.3.0 npm page — Node 11.13.0 EventEmitter API match
- react-native-builder-bob v0.43.0 docs — CJS/ESM dual-output configuration
- Expo Config Plugins documentation — plugin structure, app.plugin.js entry, library development patterns
- MikroTik RouterOS API Documentation — wire protocol: length-prefixed frames, sentence types (!done/!trap/!fatal/!re/!empty), MD5 challenge-response, tag system, word encoding
- Unicode Consortium Windows-1252 mapping — 27 characters differ in 0x80–0x9F range
- TypeScript 5.9 + 7.0 npm pages — version stability analysis for RN ecosystem
- spark-md5 v3.0.2 npm page — comparison baseline (rejected)
- node-routeros-v2 (Jace254, active fork) README — confirms API surface continuity

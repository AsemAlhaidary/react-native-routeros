# Domain Pitfalls — react-native-routeros

**Domain:** React Native library wrapping raw-TCP RouterOS protocol
**Researched:** 2026-08-10
**Overall confidence:** HIGH (source code analysis + official docs + library issue tracker review)

---

## Summary Table

| # | Pitfall | Severity | Warning Signs | Prevention Strategy | Phase |
|---|---------|----------|---------------|---------------------|-------|
| 1 | react-native-tcp-socket API mismatch vs Node net | **CRITICAL** | `socket.on('end')` never fires; `tls.connect()` not found | Use `createConnection()`, listen to `'close'` not `'end'`, use `'data'` with string not Buffer | Phase 2 (socket layer) |
| 2 | MD5 challenge byte-level encoding | **CRITICAL** | "invalid user name or password" on every login attempt with correct credentials | Build separate test harness for MD5 challenge; validate against known challenge/response pair from node-routeros | Phase 3 (login/MD5) |
| 3 | win1252 encoding — wrong byte handling | **CRITICAL** | Commands silently corrupt/Winbox shows garbled text; RouterOS returns !trap with misleading error | Pure-JS win1252 encoder with explicit 0x80-0x9F mapping table; fuzz-test against iconv-lite output | Phase 4 (encoding) |
| 4 | `0x00` null byte collision in encoded words | **CRITICAL** | RouterOS hangs waiting for more data; commands never complete | Enforce that `0x00` never appears in encoded content; validate before writing to socket | Phase 4 (encoding) |
| 5 | Socket destroyed during write (TOCTOU race) | **HIGH** | App crashes with NullPointerException on Android; random crashes under fast command throughput | Guard socket `write()` calls with writable check + pool; never write after `destroy()` | Phase 2 (socket layer) |
| 6 | RN app backgrounding kills TCP sockets | **HIGH** | Connection silently dead after app returns from background; keepalive timer fires on dead socket | AppState listener — close+reconnect on foreground; destroy socket on background | Phase 5 (robustness) |
| 7 | Android plain-TCP blocked by cleartext policy | **HIGH** | `connect()` times out on Android 9+ for port 8728; no visible error in JS | Expo plugin must add `android:usesCleartextTraffic="true"` to AndroidManifest.xml | Phase 7 (Expo plugin) |
| 8 | TLS self-signed cert handling differs iOS vs Android | **HIGH** | TLS to port 8729 works on iOS but fails on Android (or vice versa) | Test on both platforms; use PEM cert import via `require()` per react-native-tcp-socket docs | Phase 2 (socket layer) |
| 9 | RouterOS !fatal termination not distinguished from !trap | **HIGH** | App treats fatal disconnect same as per-command error; keeps trying commands on dead socket | `!fatal` → emit 'fatal' event → destroy socket → propagate as specific error type; consumer must reconnect | Phase 5 (robustness) |
| 10 | Tag collision with 0x00 default | **MEDIUM** | Intermittent "UNREGISTEREDTAG" errors under concurrent command load | Don't use empty-string tags; ensure Channel generates unique non-empty tags; validate tag before register | Phase 3 (login/tags) |
| 11 | CJS/ESM dual-output misconfiguration | **MEDIUM** | `Cannot find module` in Metro bundler; import fails in newer Expo/RN versions | builder-bob with both `main` (CJS) + `module`/`exports` (ESM); test import in bare RN project | Phase 6 (build) |
| 12 | .d.ts not shipped or incorrect | **MEDIUM** | TypeScript consumers get `any` types; no autocomplete | `tsc --declaration` in build; verify `types` field in package.json points to correct .d.ts entry | Phase 6 (build) |
| 13 | Missing `peerDependencies` for react-native-tcp-socket | **MEDIUM** | Metro resolver error about missing native module; duplicate native module linking | List `react-native-tcp-socket` as peerDependency; document install step for consumers | Phase 6 (build) |
| 14 | Hermes lacks Buffer and crypto globals | **MEDIUM** | `Buffer is not defined` at runtime on Hermes engine | Avoid Buffer; use Uint8Array + DataView for binary operations; polyfill only if unavoidable | Phase 3 (encoding) |
| 15 | Expo config plugin doesn't auto-link native code | **MEDIUM** | `Native module TcpSocket not found` in Expo dev client | Plugin must call `withPlugins()` adding react-native-tcp-socket; add permissions + build.gradle tweaks | Phase 7 (Expo plugin) |
| 16 | RouterOS v7.18+ `!empty` reply unhandled | **LOW** | Unknown reply type error on RouterOS v7.18+ for commands with no data | Add `!empty` to Channel.processPacket switch; treat as successful empty response | Phase 5 (robustness) |
| 17 | win1252 characters outside cp1252 range | **LOW** | Subtle corruption of non-Latin chars in RouterOS config data (e.g., Lithuanian names) | Map out-of-range chars to `?` or `0x3F`; document limitation | Phase 4 (encoding) |
| 18 | Multiple `connect()` calls stacking listeners | **LOW** | Duplicate responses; memory leak from growing listener count | Guard `connector.connect()` with connecting/connected flags (already in node-routeros, must preserve) | Phase 2 (socket layer) |

---

## Critical Protocol Risks

### Pitfall 2: MD5 Challenge Byte-Level Encoding (CRITICAL)

The RouterOS login challenge is **not** a string-level MD5. It operates on raw bytes. The original node-routeros code at `RouterOSAPI.js` lines 359-370:

```javascript
const challenge = Buffer.alloc(this.password.length + 17);
const challengeOffset = this.password.length + 1;
const ret = data[0].ret; // hex-encoded challenge string from router
challenge.write(String.fromCharCode(0) + this.password); // null byte + password
challenge.write(ret, challengeOffset, ret.length / 2, 'hex'); // hex→binary challenge
const resp = '00' + crypto.createHash('MD5').update(challenge).digest('hex');
```

The byte layout is: `[0x00][password_bytes][16_bytes_challenge]`

**What goes wrong:**
- Using a pure-JS MD5 that operates on strings (e.g., passing hex string directly) produces wrong hash.
- Using UTF-8 encoding for password bytes instead of Latin-1/ASCII produces different hash for non-ASCII passwords.
- Not handling the hex→binary conversion of the challenge string correctly.
- Pre-pending `"00"` as a string after computing hex digest, not as part of the response format.

**Prevention:**
1. Implement a pure-JS MD5 that accepts `Uint8Array` (e.g., `spark-md5` with `ArrayBuffer` input).
2. Build a test vector by running node-routeros against a real/challenge RouterOS instance, capture the intermediate `challenge` buffer and final `resp`, and hardcode as a unit test.
3. Use `TextEncoder` with `'latin1'` encoding when converting password to bytes.
4. Validate the hex-decoding of the challenge string: RouterOS sends 32 hex chars representing 16 bytes.

**Phase to address:** Phase 3 (login / MD5 implementation)

---

### Pitfall 3: win1252 Encoding — Wrong Byte Handling (CRITICAL)

The `Transmitter.encodeString()` and `Receiver.processRawData()` operate on the RouterOS wire protocol with win1252 character encoding. The encoding is used for word *content* (not length descriptors).

**What goes wrong:**
- Using UTF-8 instead of win1252: multi-byte UTF-8 sequences produce extra bytes, breaking the length framing.
- Encoding length descriptors: `0x80`+ bytes in the first position of a word are length markers, NOT content. Transmitter gets this right (length prefix is separate from content), but a naive rewrite could mix them.
- `iconv-lite` replacement: if the pure-JS replacement doesn't map cp1252 bytes 0x80-0x9F correctly, characters like € (0x80), ‚ (0x82), „ (0x84), † (0x86), ‡ (0x87), ˆ (0x88), ‰ (0x89), Š (0x8A), ‹ (0x8B), Œ (0x8C), Ž (0x8E) are silently corrupted.

**Prevention:**
1. Build a win1252 codec as a static lookup table (256 entries — trivially small).
2. Write a fuzz-test that round-trips every possible byte 0x00-0xFF through encode→decode and matches `iconv-lite` output.
3. In the Receiver, ensure `iconv.decode(data, 'win1252')` replacement handles the same byte→string mapping.

**Phase to address:** Phase 4 (encoding / framing)

---

### Pitfall 4: 0x00 Null Byte Collision (CRITICAL)

The RouterOS protocol uses a zero-length word (`0x00` with no content) as the **sentence terminator**. If encoded content accidentally contains `0x00`, the router interprets it as end-of-sentence and truncates the command.

**What goes wrong:**
- A password or command attribute containing `\x00` causes premature sentence termination.
- The null word that `Transmitter.write(null)` emits (line 65: `return String.fromCharCode(0)`) is the only valid `0x00` in a sentence. Any other `0x00` corrupts the protocol.

**Prevention:**
1. In the win1252 encoder, validate that no encoded byte is `0x00` (except the intentional terminator).
2. Sanitize input strings to strip `\x00` before encoding.
3. The `encodeString(null)` path must only be called for the sentence terminator, not for user-provided data.

**Phase to address:** Phase 4 (encoding / framing)

---

### Pitfall 9: RouterOS !fatal vs !trap (HIGH)

RouterOS sends two distinct error reply types:
- `!trap`: Per-command error (e.g., "input does not match any value of interface"). The channel rejects but the connection stays alive.
- `!fatal`: Connection-level error (e.g., "router was rebooted"). RouterOS closes the connection after this.

In `Receiver.processSentence()` line 198: `if (!line.hadMore && this.currentReply === '!fatal')` → emits `'fatal'` on socket → in Connector, this is handled by `this.socket.once('fatal', this.onEnd.bind(this))` → triggers `onEnd()` → emits `'close'` → destroys socket.

**What goes wrong:**
- If the rewrite doesn't distinguish `!fatal` from `!trap`, the library might keep trying commands on a dead socket.
- If `!fatal` is treated as a per-channel error, the consumer never knows the connection is dead.

**Prevention:**
1. Preserve the `!fatal`→`socket.emit('fatal')`→`onEnd`→`close` chain from the reference implementation.
2. Ensure the `'fatal'` event listener is registered as `once()`, not `on()`.
3. In the public API, `!fatal` should cause the `RouterOSAPI` to emit `'error'` or `'close'`, not silently fail.

**Phase to address:** Phase 5 (robustness / keepalive)

---

## Build/Publish Risks

### Pitfall 11: CJS/ESM Dual-Output Misconfiguration (MEDIUM)

React Native libraries need careful module format configuration. react-native-builder-bob supports both CJS and ESM targets.

**What goes wrong:**
- Metro (RN bundler) resolves `main` field; if only ESM is provided, older Metro versions fail.
- If `exports` map is missing the `"react-native"` condition, bundler picks the wrong entry.
- Source files included in npm package = bloated install + potential TS compilation issues for consumers.

**Prevention:**
```json
{
  "main": "./lib/commonjs/index.js",
  "module": "./lib/module/index.js",
  "types": "./lib/typescript/index.d.ts",
  "exports": {
    ".": {
      "types": "./lib/typescript/index.d.ts",
      "react-native": "./lib/module/index.js",
      "import": "./lib/module/index.js",
      "require": "./lib/commonjs/index.js"
    }
  },
  "files": ["lib", "src", "!**/__tests__"],
  "react-native-builder-bob": {
    "source": "src",
    "output": "lib",
    "targets": ["commonjs", "module", "typescript"]
  }
}
```

**Phase to address:** Phase 6 (build / package)

---

### Pitfall 15: Expo Config Plugin Doesn't Auto-Link Native Code (MEDIUM)

Expo config plugins run during `expo prebuild` to modify native project files.

**What goes wrong:**
- Plugin doesn't add `react-native-tcp-socket` to the iOS Podfile or Android dependencies.
- Plugin doesn't add `<uses-permission android:name="android.permission.INTERNET"/>`.
- Plugin doesn't add `android:usesCleartextTraffic="true"` for plain TCP on port 8728.
- Plugin doesn't enforce `minSdkVersion = 21` in Android build.gradle (required by react-native-tcp-socket).

**Prevention:**
The plugin must:
```typescript
// app.plugin.js
const { withPlugins, AndroidConfig, IOSConfig } = require('@expo/config-plugins');

module.exports = (config) => {
  return withPlugins(config, [
    // Add react-native-tcp-socket as a dependency
    (c) => {
      // Android: ensure usesCleartextTraffic + INTERNET permission
      c = AndroidConfig.Manifest.withAndroidManifest(c, (manifest) => {
        const app = AndroidConfig.Manifest.getMainApplicationOrThrow(manifest);
        if (!app.$['android:usesCleartextTraffic']) {
          app.$['android:usesCleartextTraffic'] = 'true';
        }
        AndroidConfig.Permissions.ensurePermission(manifest, 'android.permission.INTERNET');
        return manifest;
      });
      return c;
    },
  ]);
};
```

**Phase to address:** Phase 7 (Expo config plugin)

---

## Phase-Specific Warnings

| Phase | Topic | Likely Pitfall | Mitigation |
|-------|-------|---------------|------------|
| Phase 2 (socket layer) | `socket.on('end')` never fires | #1 — API mismatch | Use `'close'` event only; test with actual socket lifecycle |
| Phase 2 (socket layer) | TLS cert import format | #8 — cert handling | `require('cert.pem')` per react-native-tcp-socket docs |
| Phase 2 (socket layer) | Android write crash | #5 — TOCTOU race | Guard writes with `socket.writable` check |
| Phase 3 (MD5/login) | MD5 byte encoding | #2 — challenge hash | Test vector from real RouterOS instance |
| Phase 3 (MD5/login) | v6 vs v7 login differences | v7.18+ `!empty` reply | Handle both challenge and direct-login paths |
| Phase 4 (encoding) | win1252 encode/decode | #3 — byte mapping | Static lookup table; fuzz-test against iconv-lite |
| Phase 4 (encoding) | null byte in content | #4 — 0x00 collision | Validate no 0x00 in encoded words |
| Phase 5 (robustness) | Backgrounding kills socket | #6 — app lifecycle | AppState listener; reconnect on foreground |
| Phase 5 (robustness) | `!fatal` handling | #9 — fatal vs trap | Separate event chains |
| Phase 6 (build) | Module format | #11 — CJS/ESM | builder-bob with dual targets |
| Phase 6 (build) | Type declarations | #12 — .d.ts | `tsc --declaration` in build pipeline |
| Phase 7 (Expo plugin) | Native code not linked | #15 — plugin config | `withPlugins()` wrapping react-native-tcp-socket |
| Phase 7 (Expo plugin) | Android cleartext blocked | #7 — TLS policy | Manifest modification in plugin |

---

## Sources

- node-routeros v1.6.8 compiled `dist/` source code (direct analysis of Connector.js, Receiver.js, Transmitter.js, RouterOSAPI.js, Channel.js)
- [react-native-tcp-socket README (Rapsssito)](https://github.com/Rapsssito/react-native-tcp-socket) — API surface, TLS config, known issues
- [react-native-tcp-socket closed issues](https://github.com/Rapsssito/react-native-tcp-socket/issues?q=is%3Aissue+is%3Aclosed) — write() crash (#233), iOS backgrounding (#215), connect timeout (#201)
- [MikroTik RouterOS API Documentation](https://help.mikrotik.com/docs/display/ROS/API) — word encoding protocol, login sequence, !trap/!fatal semantics, v7.18 `!empty` replies, tag system
- [react-native-builder-bob (Callstack)](https://github.com/callstack/react-native-builder-bob) — CJS/ESM dual-output configuration
- RouterOS API protocol spec — length encoding (1-5 bytes), word framing, win1252 encoding, sentence structure

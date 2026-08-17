# Phase 7: Test Package on Real RouterOS v6 and v7 Routers — Research

**Researched:** 2026-08-17
**Domain:** End-to-end integration testing of an RN-only RouterOS API client against physical RouterOS v6/v7 devices
**Confidence:** HIGH

## Summary

Phase 7 is a real-hardware validation phase for a library that is **already complete** (phases 1–6, all 36 v1 requirements done). The library's public surface is `RouterOSAPI` (connect → internal MD5 login → `write`/`writeStream`/`stream`/`keepaliveBy`/`close`/`setOptions`) plus `RStream`, `Connector`, `Channel`, `Transmitter`, `Receiver`, and the `win1252` codec. The goal is to exercise every public feature against two live devices — a v6 router at `192.168.187.128:8728` and a v7 router at `192.168.187.130:8175` — with CRUD across router services and special focus on User Manager, which differs materially between v6 and v7.

**The decisive constraint:** the library *cannot* run under plain Node/tsx. `src/transport/SocketAdapter.ts` hardwires `import TcpSockets from 'react-native-tcp-socket'` and calls `TcpSockets.createConnection()`/`connectTLS()`, and `src/RouterOSAPI.ts` imports `AppState` from `react-native`. Both modules are ESM-and-NativeModules-only and cannot even be *loaded* under Node's jest runtime — `react-native-tcp-socket`'s entry (`src/index.js`) is raw ESM that imports `NativeModules` from `react-native` at module load. There is no dependency-injection seam (the socket factory is hardwired).

**Primary recommendation:** Use **Jest integration tests gated behind an env flag**, with **jest `moduleNameMapper`** redirecting `react-native-tcp-socket` → a test-only shim that bridges to Node's built-in `net`/`tls`, and `react-native` → a stub exporting a no-op `AppState`. This runs the library's **real protocol code unmodified** (Receiver framing/parsing, Transmitter length-encoding, Channel tag routing, RouterOSAPI login/commands, RStream, win1252 codec, js-md5 login) against the **real routers** from a desktop, and is fully automatable with zero new dependencies and zero source refactor. A supplementary on-device smoke test is the only way to validate the `react-native-tcp-socket` native integration itself, and is flagged as out-of-scope for automation.

Two critical findings must shape the plan:

1. **A latent connect-flow divergence** exists between the RN port and the original: `src/Connector.ts` calls `onConnect()` *synchronously* after creating the socket (the original node-routeros wires `onConnect` to the socket's `'connect'` event). Combined with the fact that `react-native-tcp-socket`'s `Socket` has **no `writable` property** and its `write()` **throws** while `_pending`, this means on a real device the login command is likely queued in the Transmitter pool and **never flushed** — `connect()` would hang until `SOCKTMOUT`. The Node-`net` bridge *masks* this (Node sockets have `writable` and buffer writes internally). This divergence is a **finding for discuss/verify**, not a test-harness refactor, but it means the net-bridge gives partial (not full) end-to-end confidence.

2. **RouterOS v7.18 introduced the `!empty` reply word**, which neither the original node-routeros `Channel` nor this port handles (`Channel.processPacket` has no `!empty` case → falls to `default` → throws `UNKNOWNREPLY`). Any command that returns no data on a v7.18+ router may crash the library. The test suite must be written to detect and report this, not silently fail.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Socket transport (TCP/TLS) | Dev machine (Node `net`/`tls` via shim) | — | The shim replaces the RN native module; real sockets reach the routers over the LAN |
| Protocol framing/parsing (Transmitter/Receiver/win1252) | In-process (library code, unmodified) | — | Exercised directly against real router bytes; this is the core value of the harness |
| MD5 login, command routing (RouterOSAPI/Channel/login) | In-process (library code, unmodified) | — | `connect()` performs the real challenge-response against the router |
| Streaming (RStream/writeStream/stream/keepalive) | In-process (library code) | Router (external) | `stream()` on `/interface/listen`-style endpoints exercises the real `!re`/`/cancel` flow |
| CRUD orchestration + idempotent cleanup | Test code (`test/integration/`) | — | Owns the create/read/update/delete/verify-gone scenario recipes and prefix cleanup |
| Router state (User Manager, services) | Router (external lab device) | — | The device under test; test code must not leave garbage |
| RN native integration + AppState lifecycle | Device/emulator (out of scope for automation) | — | Only exercisable in a real RN app; flagged as manual follow-up |

## Standard Stack

### Core (test harness — all already installed, no new runtime deps)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `jest` | `30.4.2` (installed) | Test runner | Already the project devDep (`^30.0.0`); preset `ts-jest`, `testEnvironment: node` |
| `ts-jest` | `29.4.12` (installed) | TS→JS for tests | devDep `^29.0.0`; **peerDeps confirmed `jest: ^29 || ^30`** — no version mismatch `[VERIFIED: node_modules/ts-jest/package.json]` |
| `@types/jest` | `^30.0.0` (installed) | Jest typings | devDep |
| Node `net` / `tls` | built-in (v20.19.5) | Real socket bridge in the shim | Built-in; `net.Socket`/`tls.TLSSocket` satisfy every API the library calls (`on('data'|'error'|'close'|'timeout')`, `write(Uint8Array)`, `end()`, `destroy()`, `setTimeout()`, `setKeepAlive()`, `writable`, EventEmitter `emit`) |
| `process.loadEnvFile` | built-in (Node ≥20.12) | Load `.env.test` | Available in Node 20.19.5 `[VERIFIED: node -e]`; avoids adding `dotenv` |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| (none) | — | — | The shim is plain TS importing built-in `net`/`tls`; no test utility libs required |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Jest + module-mapper shim (recommended) | RN example app on device/emulator | Only option that exercises the RN native module + AppState, but is manual, needs an RN dev env + physical device, and is not automatable in CI. Use as a *supplementary* manual smoke test, not the primary harness. |
| Jest + module-mapper shim | Plain `tsx` script with a `net` shim | `tsx` isn't a devDep; jest already provides gating, `--listTests`, `beforeAll` skip, and assertions for free. Use jest. |
| `jest.mock()` factories | `moduleNameMapper` | Both work; `moduleNameMapper` is declarative in config and applies uniformly to every importer (SocketAdapter + RouterOSAPI). Prefer `moduleNameMapper`. |

**Installation:**
```bash
# No new packages to install. Everything required is already present.
# (jest 30.4.2, ts-jest 29.4.12, @types/jest ^30.0.0, and Node built-in net/tls/process.loadEnvFile.)
```

**Version verification:** `jest` 30.4.1/30.4.2, `ts-jest` 29.4.12, `typescript` 5.9.3, Node v20.19.5, npm 10.8.2 — all confirmed present via `node --version` / `npx jest --version` / `npx tsc --version` this session `[VERIFIED]`. `ts-jest@29.4.12` peerDependencies explicitly include `jest ^30.0.0`, resolving the apparent 29-vs-30 mismatch `[VERIFIED: node_modules/ts-jest/package.json]`.

## Package Legitimacy Audit

> No new external packages are installed by this phase. The harness uses already-present devDependencies (`jest`, `ts-jest`, `@types/jest`) and Node built-ins (`net`, `tls`, `process.loadEnvFile`). The runtime deps exercised (`js-md5`, `events`, `debug`, `react-native-tcp-socket`) were already vetted in STACK.md with HIGH confidence.

| Package | Registry | Verdict | Disposition |
|---------|----------|---------|-------------|
| (none added) | — | — | No audit required — zero new installs |

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram (test execution flow)

```
                 ┌────────────────────────────── Jest (node) process ──────────────────────────────┐
                 │                                                                                │
  .env.test ───▶ │  setupFiles: loadTestEnv()   →  ROUTEROS_V6_HOST/PORT, ROUTEROS_V7_HOST/PORT,  │
 (not committed) │                                   ROUTEROS_USER, ROUTEROS_PASSWORD, PREFIX      │
                 │                                                                                │
                 │  describe("v6") / describe("v7")                                               │
                 │    beforeAll:  reachability probe → skip if unreachable                        │
                 │    test:  new RouterOSAPI({host,port,user,password})                           │
                 │           └─ await api.connect()  ──► RouterOSAPI.login() (MD5 challenge)      │
                 │                ├─ write('/system/resource/print')  ──► Transmitter.encode      │
                 │                ├─ write('/user-manager/...')  (CRUD)                           │
                 │                ├─ writeStream('/interface/print') ──► RStream                  │
                 │                ├─ stream('/interface/listen')      ──► RStream (+/cancel)      │
                 │                └─ keepaliveBy('#') / close() / setOptions()+connect()          │
                 │                                                                                │
                 │  moduleNameMapper:                                                             │
                 │    'react-native-tcp-socket' ──► shim: net.createConnection / tls.connect       │
                 │    'react-native'             ──► stub: AppState.addEventListener → {remove(){}} │
                 └──────────────────────────────────────┬─────────────────────────────────────────┘
                                                        │ real TCP/TLS (LAN)
                                                        ▼
                 ┌─────────────────────────────────────────────────────────────────────────────┐
                 │  v6 router 192.168.187.128:8728 (plain) / :8729 (TLS)   [REACHABLE]          │
                 │  v7 router 192.168.187.130:8175 (custom API port)        [REACHABLE]          │
                 │     (8728/8729 on v7 = UNREACHABLE — see Open Questions)                     │
                 └─────────────────────────────────────────────────────────────────────────────┘
```

**Flow the primary use case traces:** env → `RouterOSAPI.connect()` → shim's `net.createConnection` → real TCP handshake → `login()` MD5 challenge-response → `write()` commands (framed by the real Transmitter, parsed by the real Receiver) → CRUD/streams → `close()`. The library's entire protocol path runs unmodified; only the socket *construction* call is intercepted.

### Recommended Project Structure
```
react-native-routeros/
├── jest.integration.config.js          # separate config (roots: test/integration, testMatch *.int.ts)
├── test/
│   └── integration/
│       ├── setup.ts                    # jest setupFiles: process.loadEnvFile('.env.test')
│       ├── mocks/
│       │   ├── react-native.ts             # AppState stub
│       │   └── react-native-tcp-socket.ts  # net/tls bridge (the shim)
│       ├── helpers/
│       │   ├── client.ts               # build RouterOSAPI from env; reachability probe
│       │   ├── version.ts              # detect v6/v7 via /system/resource/print .version
│       │   └── crud.ts                 # generic idempotent CRUD runner (create/read/update/read/delete/verify-gone)
│       ├── recipes/
│       │   ├── v6.ts                   # v6 command arrays (User Manager via /tool user-manager)
│       │   └── v7.ts                   # v7 command arrays (User Manager via /user-manager)
│       ├── connect-login.int.ts        # connect, MD5 login, wrong-password → CANTLOGIN, close, reconnect
│       ├── write-read.int.ts           # write() reads: identity/resource/interface/ip/user
│       ├── writeStream.int.ts          # writeStream() finite sets + done/trap/close events
│       ├── stream.int.ts               # stream() on a listen endpoint + pause/resume/stop
│       ├── keepalive.int.ts            # keepaliveBy('#') + keepalive:true constructor
│       ├── tls.int.ts                  # TLS connect on 8729 (v6), self-signed acceptance
│       ├── error-handling.int.ts       # !trap → plain Error; unknown command; SOCKTMOUT (unreachable port)
│       └── usermanager-crud.int.ts     # v6/v7 CRUD (profile/user/router/link) — see recipes
├── .env.test.example                   # committed template (no secrets)
└── .env.test                           # gitignored — real IPs + admin/admin
```

**Integration tests must live OUTSIDE `<rootDir>/src`** so the existing `test` script (`roots: ["<rootDir>/src"]`) never picks them up. The integration config uses its own `roots`/`testMatch`.

### Pattern 1: Module-mapper shim (the transport bridge) — the crux
**What:** Redirect `react-native-tcp-socket` to a shim whose `createConnection(options, cb)` returns `net.createConnection({host, port}, cb)` and `connectTLS(options, cb)` returns `tls.connect({...options, rejectUnauthorized:false}, cb)`. Redirect `react-native` to a stub exporting `AppState.addEventListener = () => ({ remove() {} })`.
**When to use:** The *only* code change-free way to make this library run under Node jest. Mandatory regardless (the real modules can't be loaded under Node).
**Why it works despite the synchronous `onConnect()`:** Node `net.Socket` has a real `writable` property and buffers writes internally, so `Transmitter.write()` sends directly to the socket and Node flushes on connect — bypassing the Transmitter pool entirely. This is precisely why it *works* here but *would hang* on a real RN device (see Common Pitfalls).
**Example:**
```typescript
// test/integration/mocks/react-native-tcp-socket.ts
import * as net from 'net';
import * as tls from 'tls';

export interface BridgeOptions { host: string; port: number; [k: string]: unknown; }

export default {
  // SocketAdapter.createPlainSocket() calls this
  createConnection(options: BridgeOptions, callback?: () => void) {
    return net.createConnection({ host: options.host, port: options.port }, callback);
  },
  // SocketAdapter.createTlsSocket() calls this
  connectTLS(options: BridgeOptions, callback?: () => void) {
    // RouterOS API-SSL uses self-signed certs by default; RN-TCP has no rejectUnauthorized,
    // so the shim injects it for the lab self-signed case only (test scope).
    const { certAlias, keyAlias, ...rest } = options as any;
    return tls.connect({ ...rest, rejectUnauthorized: false } as tls.ConnectionOptions, callback);
  },
};
```
```typescript
// test/integration/mocks/react-native.ts
export const AppState = {
  addEventListener(_type: string, _cb: (state: string) => void) {
    return { remove() {} };
  },
};
```
```javascript
// jest.integration.config.js
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  roots: ['<rootDir>/test/integration'],
  testMatch: ['**/*.int.ts'],
  setupFiles: ['<rootDir>/test/integration/setup.ts'],
  moduleNameMapper: {
    '^react-native$': '<rootDir>/test/integration/mocks/react-native.ts',
    '^react-native-tcp-socket$': '<rootDir>/test/integration/mocks/react-native-tcp-socket.ts',
  },
  testTimeout: 30000, // real-device latency + MD5 login + CRUD round-trips
};
```

### Pattern 2: Env-gated, reachability-skipped suites
**What:** `beforeAll` probes the configured host:port with a 2s `TcpClient`; if unreachable (or `ROUTEROS_*_HOST` unset), `test.skip`/return early so `npm run test:integration` degrades to a no-op "skipped" instead of a red run. Gate the whole run behind `ROUTEROS_INTEGRATION=1` in CI.
**When to use:** To keep integration tests out of normal `npm test` (which runs the `src/` unit suite) and CI-green when no lab device is reachable.
**Example:**
```typescript
// helpers/client.ts
function loadTestEnv() {
  // process.loadEnvFile throws if missing; .env.test is gitignored
  try { process.loadEnvFile('.env.test'); } catch { /* optional defaults */ }
}
export function reachable(host: string, port: number, ms = 2000): boolean {
  const c = new (require('net').Socket)();
  return new Promise((res) => {
    c.setTimeout(ms, () => { c.destroy(); res(false); });
    c.once('error', () => { c.destroy(); res(false); });
    c.connect(port, host, () => { c.destroy(); res(true); });
  });
}
```

### Pattern 3: Per-version command recipes (v6 vs v7)
**What:** A `recipes/v6.ts` and `recipes/v7.ts` module export the command arrays for each service. `helpers/version.ts` detects the version from `/system/resource/print`'s `.version` field (e.g. `"7.14.2"` vs `"6.49.10"`) and selects the recipe. Test files consume recipe objects, never inline literals.
**When to use:** Everywhere the goal says "v6 vs v7 differ" — chiefly User Manager, secondarily `/system/resource` field names.
**Example (recipe shape):**
```typescript
// recipes/v7.ts
export const userManager = {
  enable:      ['/user-manager/set', '=enabled=yes'],
  profileAdd:  (name: string) => ['/user-manager/profile/add', `=name=${name}`, '=validity=1d'],
  profileRead: () => ['/user-manager/profile/print'],
  profileSet:  (id: string, validity: string) => ['/user-manager/profile/set', `.id=${id}`, `=validity=${validity}`],
  profileDel:  (id: string) => ['/user-manager/profile/remove', `.id=${id}`],
  userAdd:     (name: string, pw: string) => ['/user-manager/user/add', `=name=${name}`, `=password=${pw}`, '=group=default'],
  userRead:    () => ['/user-manager/user/print'],
  userSet:     (id: string, pw: string) => ['/user-manager/user/set', `.id=${id}`, `=password=${pw}`],
  userDel:     (id: string) => ['/user-manager/user/remove', `.id=${id}`],
  linkAdd:     (user: string, profile: string) => ['/user-manager/user-profile/add', `=user=${user}`, `=profile=${profile}`],
  routerAdd:   (name: string) => ['/user-manager/router/add', `=name=${name}`, '=address=127.0.0.1', '=shared-secret=gsdtest'],
};
```

### Pattern 4: Idempotent CRUD with a unique prefix + cleanup
**What:** Every created entity gets a unique name `gsd-itest-<random4>`; a `crud.ts` helper runs create→read(assert present)→update→read(assert changed)→delete→read(assert gone), and a `finally`/`afterAll` sweeps any leftover entities whose `.name` (or `.username`) starts with the prefix, removing them by `.id`.
**When to use:** All CRUD — prevents accumulating garbage on the lab routers even when a test aborts mid-sequence.

### Anti-Patterns to Avoid
- **Putting integration tests under `src/`:** the base `jest` config has `roots: ["<rootDir>/src"]` and would run them in `npm test`. Keep them in `test/integration/` with a separate config.
- **Mocking `react-native-tcp-socket` with a fake socket:** reimplementing socket semantics is exactly the "reimplementation" trap — the whole point is real bytes to a real router. Bridge to real `net`/`tls`.
- **Hardcoding `admin/admin` or IPs in test files:** must come from `.env.test` (gitignored). See Security Domain.
- **Using `=attr=val` for `print` filtering:** the API filters `print` via *query words* (`?name=value`), not attribute words — and query-word filtering is version-sensitive. Prefer fetch-all + client-side filter for assertions (most robust across v6/v7).
- **Assuming `!done`-only replies:** v7.18+ may emit `!empty` for empty-result commands (see Pitfalls), which this library does not handle.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| RouterOS word length-encoding | A test-side encoder | Library's `Transmitter` (already correct) | The bridge reuses it; re-encoding in tests duplicates the very logic under test |
| RouterOS reply parsing | A test-side parser | Library's `Receiver` | Same reason — parse real router bytes with the real code |
| MD5 challenge-response | A test-side MD5 | Library's `login()` → `js-md5` | Never reimplement crypto; the login path is already tested in-process |
| win1252 codec | A test-side codec | Library's `win1252` | Already verified against iconv-lite in Phase 1 |
| A fake/mock socket | A hand-written socket double | Node `net`/`tls` via the shim | Real sockets produce real chunk boundaries, TCP semantics, and TLS handshakes |
| A custom test runner | A bespoke script runner | jest + ts-jest | Already present; gives gating, `beforeAll` skip, assertion diffs |
| Env-file parsing | `dotenv` dependency | Built-in `process.loadEnvFile` | Node 20.19.5 has it; zero new deps |

**Key insight:** The harness's job is to *remove* the one thing that can't run under Node (the native socket module) and replace it with the platform's real socket — not to reimplement anything the library already does. Everything from the win1252 codec up through `RouterOSAPI` stays untouched.

## Runtime State Inventory

> Not a rename/refactor/migration phase — **omitted by rule**. (No strings are renamed; no stored data, OS state, secrets keys, or build artifacts change. The only "state" touched is transient CRUD entities on the lab routers, which the test prefix + cleanup handles.)

## Common Pitfalls

### Pitfall 1: The net-bridge masks the RN connect-flow divergence (false confidence)
**What goes wrong:** On a real device, `Connector.connect()` calls `onConnect()` synchronously and never wires `onConnect` to the socket's `'connect'` event (the original node-routeros does `socket.once('connect', this.onConnect)`). `react-native-tcp-socket`'s `Socket` has no `writable` property (always falsy → Transmitter pools every frame) and its `write()` throws while `_pending`. Result: login frames sit in the pool forever → `connect()` hangs → `SOCKTMOUT`. Under the Node-`net` bridge this is invisible because Node sockets have `writable` and buffer writes internally.
**Why it happens:** The RN port's synchronous `onConnect()` + the reliance on a Node-only `writable` getter — a porting deviation from the original.
**How to avoid (in this phase):** Document it as a known gap. Write the harness so a green run means "protocol + commands + CRUD verified against real routers", and add an explicit `open-question`/`finding` note (and ideally a manual device smoke test) for the socket-connect-timing layer. Do **not** claim full end-to-end device validation from the bridge alone.
**Warning signs:** Any future attempt to make the bridge "more faithful" (emulate `_pending`/no-`writable`) will expose the hang — which is correct, and should be reported, not papered over.

### Pitfall 2: `!empty` reply (RouterOS 7.18+) crashes the library
**What goes wrong:** `Channel.processPacket` has cases only for `!re`/`!done`; anything else (`!empty`, introduced in RouterOS 7.18) hits `default` → `emit('unknown')` → throws `RosException('UNKNOWNREPLY')`. The original node-routeros has the same gap `[VERIFIED: node-routeros/dist/Channel.js]`.
**Why it happens:** Upstream limitation, inherited verbatim.
**How to avoid:** In `error-handling.int.ts`, issue a command expected to return no data (e.g. a `/.../set` that matches nothing, or a `print` of an empty list) on the v7 router, and assert/tolerate the current behavior while recording it as a finding. Do not let the whole suite die on it — catch, log, and mark a dedicated "known-gap" assertion.
**Warning signs:** The v7 router runs ≥7.18 (unknown currently — detect via `/system/resource/print` `.version`).

### Pitfall 3: v7 non-standard API port (8175)
**What goes wrong:** The goal hardcodes `v7 = 192.168.187.130:8175`. 8175 is **not** the standard API port — RouterOS API is 8728/8729 `[CITED: help.mikrotik.com/docs/display/ROS/API]`. Reachability probes show 8175 **open** and 8728/8729 **closed** on the v7 host, so it is likely a custom `/ip service` API port or a NAT forward — but it could also be a typo in the goal.
**Why it happens:** Custom lab config or a transcription error.
**How to avoid:** Treat host+port as fully env-driven per device (the library already supports `port`). Flag as an Open Question requiring user confirmation of what 8175 actually is.

### Pitfall 4: jest base config captures integration tests
**What goes wrong:** `package.json` `jest.roots` is `["<rootDir>/src"]`; if integration files land under `src/`, `npm test` runs them (and fails when routers are offline).
**How to avoid:** Separate `jest.integration.config.js` with its own `roots`/`testMatch` (`test/integration/**/*.int.ts`) and a `test:integration` script.

### Pitfall 5: Leftover CRUD garbage on the lab routers
**What goes wrong:** Failed mid-sequence tests leave users/profiles on the router.
**How to avoid:** Unique `gsd-itest-` prefix + `afterAll` sweep by prefix (remove by `.id`), and `finally`-guarded delete.

### Pitfall 6: User Manager not enabled on the device
**What goes wrong:** `/user-manager/*` (v7) and `/tool user-manager/*` (v6) commands `!trap` if the User Manager package/feature isn't enabled (`/user-manager set enabled=yes`, v6: `/tool user-manager set enabled=yes`).
**How to avoid:** A `beforeAll` pre-flight attempts the enable command (may itself fail on license-limited devices); if User Manager is unavailable, `test.skip` the User-Manager suite with a clear reason rather than failing.

## Code Examples

Verified patterns from official sources:

### RouterOS API word/frame encoding (matches the library exactly)
```
// Source: help.mikrotik.com/docs/display/ROS/API  [CITED]
0 <= len <= 0x7F              → 1 byte:  len
0x80 <= len <= 0x3FFF         → 2 bytes: len | 0x8000
0x4000 <= len <= 0x1FFFFF     → 3 bytes: len | 0xC00000
0x200000 <= len <= 0xFFFFFFF  → 4 bytes: len | 0xE0000000
len >= 0x10000000             → 5 bytes: 0xF0 + len (4 bytes)
// Reply words: !done (last reply), !trap (error + =message=, =category=),
//              !re (data), !fatal (connection close reason), !empty (v7.18+, no data)
// Tag: .tag=<value> routes responses; attribute word: =name=value; query word: ?name=value
```

### Initial login (post-v6.43 MD5 challenge-response) — exercised by `connect()`
```
// Source: help.mikrotik.com/docs/display/ROS/API  [CITED]
>>> /login
>>> =name=admin
>>> =password=
<<< !done
<<< =ret=856780b7411eefd3abadee2058c149a3     ← 32-hex challenge
>>> /login
>>> =name=admin
>>> =response=005062f7a5ef124d34675bf3e81f56c556
<<< !done
```
The library's `login()` builds the response as `'00' + md5([0x00] + passwordBytes + hexDecode(ret))` `[VERIFIED: src/RouterOSAPI.ts, src/md5.ts]`.

### v7 User Manager command shapes (authoritative)
```
// Source: help.mikrotik.com/docs/display/ROS/User+Manager  [CITED]
/user-manager set enabled=yes
/user-manager router add name=local address=127.0.0.1 shared-secret=test     # v7 "router" = NAS/RADIUS client
/user-manager user add name=user1 password=password                          # user: name, password, group, shared-users, caller-id, disabled, ...
/user-manager profile add name=p validity=1d name-for-users=p                # profile: name, validity, starts-when, price, ...
/user-manager user-profile add user=user1 profile=p                          # assign profile to user (v7-specific link table)
/user-manager user print   /   set [find name=user1] ...   /   remove [find name=user1]
```

### Reading other services (stable across v6/v7)
```
// Source: help.mikrotik.com/docs/display/ROS/API  [CITED for /user/getall shape]
/system/resource/print   →  =uptime=.. =version=.. =cpu-load=0 =free-memory=.. =total-memory=.. =board-name=..
/system/identity/print   →  =name=<router-identity>
/interface/print         →  =name=ether1 =type=ether =mtu=1500 =running=yes
/ip/address/print        →  =address=192.168.88.1/24 =interface=.. =network=..
/user/print (getall)     →  =.id=*1 =name=admin =group=full =address=0.0.0.0/0   [CITED]
```
Note: the API doc's OID example confirms v7 uses `cpu-load` (v6 used `cpu` for the percentage) `[CITED for cpu-load; v6 cpu field: ASSUMED]`.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| v6 User Manager: `/tool user-manager` with `customer`, `user`, `profile`, `limitation`, `session`, `user-counters` | v7 User Manager: `/user-manager` with `user`, `profile`, `user-profile`, `router` (← "customer"), `limitation`, `profile-limitation`, `user group`, `session`, `database` | RouterOS v7 | The goal's "v6 vs v7 differ" is most acute here; tests need per-version recipes `[CITED for v7; v6 field names: ASSUMED]` |
| Pre-6.43 login: separate `/login` without challenge | v6.43+ MD5 challenge-response (single `/login`, optional `ret` challenge) | v6.43 | The library implements the 6.43+ flow; both test devices are ≥6.43 |
| `!done`-only empty replies | `!empty` reply word for no-data commands | v7.18 | Unhandled by the library (and upstream) — see Pitfall 2 |
| No API query words | Query words (`?name=x`) for `print` filtering | long-standing | Prefer fetch-all + client-side filter in tests for portability |

**Deprecated/outdated:**
- `iconv-lite` for win1252 — already replaced in this library by the 1.5KB lookup table (Phase 1); do not reintroduce.
- RN's built-in `EventEmitter` — already replaced by the `events` package; the shim must not reintroduce it.
- `spark-md5` / `crypto-js` for MD5 — `js-md5` is the vetted choice.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | v6 User Manager commands are `/tool user-manager customer|user|profile|limitation|session` with field `username`/`customer` (not v7's `name`/flat users) | Code Examples / recipes | Tests would send wrong command paths/fields to the v6 router and `!trap`; mitigable because the suite detects version and can adapt, and reads back via `print` before asserting |
| A2 | v6 `/system/resource/print` uses `cpu` (percentage) where v7 uses `cpu-load` | Code Examples | Assertion on the wrong field name returns `undefined` and fails; low impact (read-only probe) |
| A3 | The v7 device's 8175 port is a custom API port (not a typo or a different service) | Open Questions / Env | If 8175 is actually a non-API service, TLS/plain-TCP handshake assumptions break and the connect test fails loudly (easy to diagnose) |
| A4 | Both lab routers are already on ≥v6.43 and ≥v7.0, and `admin/admin` credentials are valid | Security Domain | `CANTLOGIN` on connect; requires user to provide real credentials via `.env.test` |
| A5 | User Manager is installed/licensed and can be enabled on both devices | Common Pitfalls 6 | User-Manager suite is skipped rather than failing; acceptable degradation |

**If this table is empty:** n/a — assumptions listed above need user confirmation during discuss/verify.

## Open Questions

1. **What is the v7 service on port 8175?**
   - What we know: 8175 is reachable from this dev machine; 8728/8729 are not `[VERIFIED: TCP probe]`. RouterOS API standard ports are 8728/8729 `[CITED]`.
   - What's unclear: whether 8175 is a custom `/ip service` API port, a NAT forward, or a typo.
   - Recommendation: ask the user to confirm; keep port env-driven (`ROUTEROS_V7_PORT`, default 8175) so it's trivially changeable.

2. **The RN connect-flow divergence (synchronous `onConnect()` + missing `writable`) — fix now or record-only?**
   - What we know: the RN port deviates from the original (synchronous `onConnect`, no socket-'connect' wiring); RN-TCP `Socket` lacks `writable` and throws while pending `[VERIFIED: src/Connector.ts, node_modules/react-native-tcp-socket/src/Socket.js]`. The net-bridge masks it.
   - What's unclear: whether the user wants Phase 7 to surface this as a finding (TEST-only) or to also patch `Connector.ts`/`SocketAdapter.ts`.
   - Recommendation: keep Phase 7 test-only per the goal; file the divergence as a finding for a follow-up fix phase (or `/gsd-debug`). Do not silently refactor inside a test phase.

3. **Exact RouterOS version of each device**
   - What we know: unknown; the v7 port anomaly hints at custom config.
   - What's unclear: v7 minor version (≥7.18 changes `!empty` behavior) and v6 minor version (affects User Manager field shape).
   - Recommendation: the `connect-login.int.ts` should log `/system/resource/print` `.version` for both devices as its first assertion.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | jest runtime | ✓ | v20.19.5 | — |
| npm | scripts | ✓ | 10.8.2 | — |
| jest | test runner | ✓ | 30.4.1 | — |
| ts-jest | TS preset | ✓ | 29.4.12 (peer-supports jest 30) | — |
| typescript | typecheck | ✓ | 5.9.3 | — |
| `process.loadEnvFile` | env loading | ✓ | Node ≥20.12 (present) | manual `process.env` |
| v6 router 8728 (plain TCP) | connect/login/CRUD | ✓ | — | — |
| v6 router 8729 (TLS) | TLS suite | ✓ | — | skip TLS suite if closed |
| v7 router 8175 (custom) | connect/login/CRUD | ✓ | — | — |
| v7 router 8728/8729 | — | ✗ (closed) | — | use 8175 per goal |
| Device/emulator (RN) | true native-module validation | ✗ | — | out of scope; manual smoke test |

**Missing dependencies with no fallback:**
- None that block execution — the net-bridge + reachable routers + existing jest/ts-jest cover the automatable scope.

**Missing dependencies with fallback:**
- Real RN device/emulator (for validating the `react-native-tcp-socket` native layer + AppState): fallback = document as a manual follow-up; the net-bridge validates everything above the socket layer.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | jest 30.4.2 + ts-jest 29.4.12 (preset) |
| Config file | `jest.integration.config.js` (to be created — Wave 0) |
| Quick run command | `npx jest -c jest.integration.config.js connect-login.int.ts` |
| Full suite command | `npm run test:integration` (→ `ROUTEROS_INTEGRATION=1 jest -c jest.integration.config.js`) |

### Phase Requirements → Test Map
> No formal requirement IDs exist (phase_req_ids is null). The map below keys on the phase goal's feature list and the scenario list from `docs/EXAMPLES.md`.

| Feature (goal) | Behavior | Test Type | Automated Command | File Exists? |
|----------------|----------|-----------|-------------------|-------------|
| connect/login (MD5) | `connect()` resolves on valid creds; rejects `CANTLOGIN` on bad creds | integration | `npx jest -c jest.integration.config.js connect-login.int.ts` | ❌ Wave 0 |
| write | `write('/system/identity/print')` returns parsed array | integration | `... write-read.int.ts` | ❌ Wave 0 |
| writeStream | finite stream emits `data`/`done`/`close` | integration | `... writeStream.int.ts` | ❌ Wave 0 |
| stream | `stream('/interface/listen')` emits `!re`, `pause`/`resume`/`stop` work | integration | `... stream.int.ts` | ❌ Wave 0 |
| keepalive | `keepaliveBy('#')` + `keepalive:true` keep session alive | integration | `... keepalive.int.ts` | ❌ Wave 0 |
| reconnection | after `close()`, `setOptions()+connect()` succeeds | integration | `... connect-login.int.ts` | ❌ Wave 0 |
| TLS | TLS connect on 8729 (self-signed) succeeds | integration | `... tls.int.ts` | ❌ Wave 0 |
| error handling | `!trap` rejects plain Error; bad port → `SOCKTMOUT`/`ECONNREFUSED` | integration | `... error-handling.int.ts` | ❌ Wave 0 |
| CRUD (services) | idempotent create/read/update/delete with cleanup | integration | `... usermanager-crud.int.ts` | ❌ Wave 0 |
| User Manager v6 vs v7 | per-version recipe CRUD (profile/user/router/link) | integration | `... usermanager-crud.int.ts` | ❌ Wave 0 |
| Read other services | identity/resource/interface/ip/user print | integration | `... write-read.int.ts` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npx tsc --noEmit` (library + test types) + the specific `*.int.ts` file if routers reachable, else `npx jest -c jest.integration.config.js` (skips gracefully).
- **Per wave merge:** `npm run test` (unit, must stay green) + `npm run test:integration`.
- **Phase gate:** `typecheck` green + unit suite green + integration suite green against both routers (or documented skips) before `/gsd-verify-work`.

### Wave 0 Gaps
- [ ] `jest.integration.config.js` — separate config (roots `test/integration`, moduleNameMapper for the two mocks, `setupFiles`)
- [ ] `test/integration/mocks/react-native.ts` and `mocks/react-native-tcp-socket.ts` — the bridge/stub
- [ ] `test/integration/setup.ts` — `process.loadEnvFile('.env.test')`
- [ ] `test/integration/helpers/{client,version,crud}.ts` — env/reachability, version detection, CRUD runner
- [ ] `test/integration/recipes/{v6,v7}.ts` — per-version command arrays
- [ ] `.env.test.example` (committed template) + `.gitignore` entry for `.env.test`
- [ ] `package.json` script `"test:integration": "jest -c jest.integration.config.js"`

*(All Wave 0 — zero integration test infrastructure exists today; the base `jest` config is configured but has no test files.)*

## Security Domain

> `security_enforcement: true` (config). ASVS level 1.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | Partial | The library performs RouterOS MD5 challenge-response login (`js-md5`); the phase does not *build* auth. Do not reimplement the MD5/login — exercise the existing path only. |
| V3 Session Management | Partial | `keepalive`/session-hold logic is the library's; tests must not leave open sessions (always `close()` in `afterAll`). |
| V4 Access Control | No | No authorization model is built; the router enforces access. |
| V5 Input Validation | Yes (test config) | Validate/parse env config defensively (port is integer, host is a sane IP); never interpolate env values into shell commands. |
| V6 Cryptography | Yes | Never hand-roll crypto. MD5 = `js-md5` (existing). TLS = Node `tls` in the shim; the `rejectUnauthorized:false` is **test-scope only** for the lab self-signed cert — document it, never ship it as library behavior. |

### Known Threat Patterns for this phase

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Credentials committed to git (admin/admin + lab IPs) | Information Disclosure | `.env.test` gitignored; `.env.test.example` committed with placeholders; no secrets in test files or goal text |
| Plaintext admin password over TCP:8728 | Information Disclosure (Sniffing) | Inherent to the RouterOS cleartext API; accepted for lab scope; TLS suite on 8729 demonstrates the encrypted path |
| Test commands mutate a non-lab router (wrong host in env) | Tampering / DoS | Unique `gsd-itest-` prefix + cleanup; document that hosts must be lab-only; optional guard asserting host is within the private lab subnet before writing |
| Reimplementing MD5/TLS in test helpers | Crypto misuse | Reuse `js-md5` + Node `tls`; never hand-roll |

## Sources

### Primary (HIGH confidence — VERIFIED)
- `src/transport/SocketAdapter.ts`, `src/Connector.ts`, `src/RouterOSAPI.ts`, `src/Channel.ts`, `src/Receiver.ts`, `src/Transmitter.ts`, `src/RStream.ts`, `src/md5.ts`, `src/types.ts`, `src/types/react-native.d.ts` — read in full this session; established the hardwired RN-TCP import, the `AppState` import, the synchronous `onConnect()`, and the `!empty`-unhandled `Channel`.
- `node-routeros/dist/connector/Connector.js`, `dist/Channel.js`, `dist/connector/Transmitter.js` — established the original's socket-`'connect'` wiring and the inherited `!empty` gap.
- `node_modules/react-native-tcp-socket/src/index.js`, `src/Socket.js`, `package.json` — ESM+NativeModules entry, no `writable` getter, `write()` throws while `_pending`.
- MikroTik API docs (`help.mikrotik.com/docs/display/ROS/API`) — ports 8728/8729, word/frame encoding, reply words (`!done`/`!trap`/`!re`/`!fatal`/`!empty` since 7.18), login flow, tag/query-word syntax.
- MikroTik User Manager docs (`help.mikrotik.com/docs/display/ROS/User+Manager`) — full v7 `/user-manager` submenu tree and the v6→v7 "Migrating from RouterOS v6" note (customer→router).
- Environment probes: `node --version`, `npm --version`, `npx jest --version`, `npx tsc --version`, `process.loadEnvFile` availability, `ts-jest` peerDeps, TCP reachability to both devices.

### Secondary (MEDIUM confidence — CITED)
- `docs/EXAMPLES.md` and `examples/basic-usage.ts` (phase 6 output) — the 12-scenario feature list used to derive the test map.
- `.planning/ROADMAP.md`, `STATE.md`, `config.json` — phase goal verbatim, prior decisions, `security_enforcement:true`, `nyquist_validation:true`.

### Tertiary (LOW confidence — ASSUMED)
- v6 User Manager command paths/field names (`/tool user-manager customer|user|profile`, `username`/`customer` fields) — training knowledge; the v6 wiki fetch redirected to the frozen docs and could not be verified directly.
- v6 `/system/resource/print` `cpu` field (vs v7 `cpu-load`) — training knowledge; the v7 `cpu-load` is CITED but the v6 field name is not independently confirmed this session.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all tools verified present this session; no version mismatch after checking ts-jest peerDeps.
- Architecture: HIGH — the module-mapper bridge is derived from reading the actual source and RN-TCP internals; the connect-flow divergence is verified from code, not assumed.
- Pitfalls: HIGH — the `!empty` gap, port anomaly, and masking divergence are all traced to verified code/docs; v6-specific command shapes are the only LOW-confidence area.
- v6/v7 CLI differences: MEDIUM — v7 structure is CITED from official docs; v6 command shapes are ASSUMED and must be confirmed against the live v6 router (the suite reads back via `print`, so errors are self-diagnosing).

**Research date:** 2026-08-17
**Valid until:** 2026-09-17 (30 days — RouterOS CLI and library internals are stable; re-verify if a RouterOS minor-version change alters `/user-manager` shape).

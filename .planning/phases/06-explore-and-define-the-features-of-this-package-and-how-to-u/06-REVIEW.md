---
phase: 06-explore-and-define-the-features-of-this-package-and-how-to-u
reviewed: 2026-08-17T12:00:00Z
depth: deep
files_reviewed: 5
files_reviewed_list:
  - examples/basic-usage.ts
  - docs/API.md
  - docs/EXAMPLES.md
  - docs/INSTALLATION.md
  - README.md
findings:
  critical: 1
  warning: 2
  info: 1
  total: 4
status: issues_found
---

# Phase 06: Code Review Report

**Reviewed:** 2026-08-17T12:00:00Z
**Depth:** deep (cross-file accuracy verification: every documented name, signature, event, and behavior was checked against `src/*.ts`, `src/transport/SocketAdapter.ts`, `plugin/src/*.ts`, and `package.json`)
**Files Reviewed:** 5
**Status:** issues_found

## Summary

This is a documentation/example phase. The five changed files are largely accurate: the public-export table in `docs/API.md` matches `src/index.ts` exactly (all 20 exports present, none invented), method/event signatures for `RouterOSAPI`, `RStream`, `Channel`, `Connector`, `Transmitter`, `Receiver`, `RosException`, and the codec/utils helpers all match the source, the `messages` catalog keys are quoted correctly, the Expo config-plugin behavior in `docs/INSTALLATION.md` matches `plugin/src/*.ts`, and every example uses the correct `connect → write/stream → close` pattern with no invented login method and no real credentials (all placeholders).

Two substantive defects were found: (1) the docs describe a TLS port auto-selection behavior that does not actually occur at the `RouterOSAPI` level — a user following the TLS example would connect TLS on the wrong port and fail; and (2) the error-handling examples imply that `write()` command traps surface as `RosException` with `errno`, when in fact they reject with a plain `Error`. One additional docs-vs-`package.json` mismatch and one imprecise phrasing round out the findings.

## Critical Issues

### CR-01: Documented TLS port auto-selection (port 8729) does not happen — `tls: {}` connects on the wrong port

**File:** `docs/API.md:49,83`, `docs/EXAMPLES.md:248`, `README.md:243` (root cause: `src/RouterOSAPI.ts:66`, `src/Connector.ts:50-58`)

**Issue:**
The docs repeatedly state that TLS "auto-selects 8729 when `tls` is set and `port` is omitted":

- `docs/API.md:49` — `port` default "8728 (plain) / 8729 (TLS) … TLS auto-selects 8729 when `tls` is set and `port` is omitted"
- `docs/EXAMPLES.md:248` — `// Enable TLS with defaults — port auto-selects 8729 when no port is given` with `tls: {}` and no `port`
- `README.md:243` — `tls: {}, // enables TLS; defaults to port 8729 when no port is given`

This behavior does **not** occur through `RouterOSAPI`:

1. `RouterOSAPI.setOptions()` runs `this.port = options.port || 8728` (`src/RouterOSAPI.ts:66`), so an omitted `port` becomes the literal `8728`.
2. `RouterOSAPI.connect()` passes that explicit value to the connector: `new Connector({ host, port: this.port, … })` (`src/RouterOSAPI.ts:96-101`).
3. In `Connector`'s constructor, the 8729 auto-select only fires when `port` is falsy — `if (!options.port) this.port = 8729` (`src/Connector.ts:57`) — but `port` is always `8728` here, so the branch is dead.

Net effect: `new RouterOSAPI({ host, tls: {} })` attempts a TLS handshake on port **8728** (the plain-API port). RouterOS serves the TLS API on **8729**, so the connection fails. The first TLS example in `docs/EXAMPLES.md` §11 and the `README.md` TLS example both demonstrate broken behavior. (The second example in §11 works only because it sets `port: 8729` explicitly.)

**Fix:**
Either fix the source so the documented behavior is true, or correct the docs. Recommended source fix (make the auto-select work end-to-end):

```typescript
// src/RouterOSAPI.ts — setOptions()
this.port = options.port || (options.tls ? 8729 : 8728);
```

If the source is not changed, the docs must instruct users to pass `port: 8729` explicitly whenever using TLS:

```typescript
// docs/EXAMPLES.md §11 and README.md TLS section
const tlsApi = new RouterOSAPI({
  host: 'router.example.com',
  user: 'admin',
  password: 'password',
  port: 8729, // REQUIRED — TLS does not auto-select 8729 at the RouterOSAPI level
  tls: {},
});
```

Also correct `docs/API.md:49` (`IRosOptions.port` default) and `docs/API.md:83` (`ConnectorOptions.port` default) to drop the "TLS auto-selects 8729" wording. Note the `ConnectorOptions.tls` row at `docs/API.md:85` has a related nuance: `tls: true` (boolean) enables TLS but leaves the port at 8728 (only the object form sets 8729, and only when `port` is falsy).

## Warnings

### WR-01: `react-native-tcp-socket` is a direct `dependency` *and* a `peerDependency`, but docs describe it as peer-only and instruct a manual install

**File:** `docs/INSTALLATION.md:38-50`, `README.md:13-37` (root cause: `package.json:72-82`)

**Issue:**
`package.json` lists `react-native-tcp-socket@^6.4.2` in **both** `dependencies` (`package.json:76`) and `peerDependencies` (`package.json:81`). The docs describe it only as a peer dependency and tell users to install it manually because it is "not bundled":

- `docs/INSTALLATION.md:38` — "The library declares three `peerDependencies` … which must be present in your project. Install them explicitly"
- `docs/INSTALLATION.md:50` — "You must install it yourself because it is not bundled with React Native"
- `README.md:19` — "you must install it yourself because it is not bundled with React Native"

Because it is also a regular `dependency`, npm/yarn **will** auto-install it, so the "install it yourself" step is redundant and the "peer-only" framing is inaccurate. Separately, listing a native module in both `dependencies` and `peerDependencies` is a known anti-pattern that can resolve to two copies of the native module (and its Android/iOS registration), which matters for an autolinked native module.

**Fix:**
Decide the intent and make docs + `package.json` consistent. Either:
- Remove `react-native-tcp-socket` from `dependencies` and keep it peer-only (then the "install it yourself" guidance is correct), or
- Keep it as a `dependency` and update the docs to say it is installed automatically while `react`/`react-native` are the peers that must already exist.

### WR-02: Error-handling examples treat `write()` traps as `RosException`, but `write()` rejects with a plain `Error`

**File:** `docs/EXAMPLES.md:278-291` (§12), and the same framing in `examples/basic-usage.ts:39-45` and `docs/INSTALLATION.md:149-155`

**Issue:**
`docs/EXAMPLES.md` §12 ("Error handling — look up errno against the catalog") wraps `api.write('/ip/address/print')` in a try/catch and branches on `err instanceof RosException`, then reads `err.errno`. But a RouterOS `!trap` from a command rejects with a **plain `Error`**, not a `RosException`:

```typescript
// src/Channel.ts:77-79
this.once('trap', (data) => reject(new Error(data.message)));
```

`RouterOSAPI.write()` returns `chann.write(params)` (`src/RouterOSAPI.ts:402`), so a trap surfaces as `new Error(message)` with no `errno` and no `RosException` prototype. The §12 example would therefore fall into its `else` branch and print "Unexpected error" rather than the friendly mapped message it demonstrates. (`err.errno` is only guaranteed on connection/login/timeout failures, where `connect()` and the `Connector` genuinely reject with `RosException`.)

**Fix:**
Correct the example to distinguish the two error classes honestly, or drop the `errno` lookup from the `write()`-based example and demonstrate it on a `connect()` failure instead:

```typescript
try {
  await api.connect(); // rejects with RosException (CANTLOGIN/SOCKTMOUT/ECONNREFUSED)
} catch (err) {
  if (err instanceof RosException) {
    console.error(`RouterOS error (${err.errno}): ${messages[err.errno] ?? err.message}`);
  } else {
    console.error('Unexpected error:', err);
  }
}

// A command !trap is a plain Error with a .message, e.g.:
try {
  await api.write('/ip/address/print');
} catch (err) {
  console.error('Command failed:', (err as Error).message);
}
```

## Info

### IN-01: README says the config plugin "auto-links" `react-native-tcp-socket`, but the plugin only verifies presence

**File:** `README.md:57`

**Issue:**
`README.md:57` states "The plugin auto-links `react-native-tcp-socket`…". The plugin does not perform autolinking — it *verifies* the module is installed (`plugin/src/withAndroid.ts:17-27` throws if missing; `plugin/src/withIos.ts:19-30` warns) and then applies the Android manifest mutations (`INTERNET` permission + `usesCleartextTraffic`). Autolinking is performed by React Native's own autolinking step once the module is present. `docs/INSTALLATION.md:112-126` describes this accurately; the README's wording overstates the plugin's role.

**Fix:** Reword to match reality, e.g. "The plugin verifies `react-native-tcp-socket` is installed (so React Native autolinking can register it) and applies the Android `INTERNET` permission and `usesCleartextTraffic` setting…".

---

_Reviewed: 2026-08-17T12:00:00Z_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: deep_

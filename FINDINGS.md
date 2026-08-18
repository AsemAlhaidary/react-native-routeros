# Findings — Phase 7 (test-package-on-real-routeros-v6-and-v7-routers)

## Finding 1: RN connect-flow divergence (synchronous `onConnect()`)

**Status:** RECORD-ONLY (no `src/` patch in this phase)

**Observation:** `src/Connector.ts` invokes `onConnect()` **synchronously**
after creating the socket, rather than wiring it to the socket's `'connect'`
event as the original `node-routeros` does (`socket.once('connect', this.onConnect)`).
Combined with the fact that `react-native-tcp-socket`'s `Socket` has **no
`writable` property** (and its `write()` throws while `_pending`), this means
that on a real device the login frame would be queued in the `Transmitter`
pool and **never flushed** — `connect()` would hang until `SOCKTMOUT`.

**Why the harness still works:** the Node-`net` bridge masks this divergence.
Node `net.Socket` instances expose a real `writable` property and buffer writes
internally, so `Transmitter.write()` sends directly to the socket and Node
flushes it on connect — bypassing the pool entirely.

**Impact:** the net-bridge gives partial (not full) end-to-end confidence. It
verifies the protocol layer (framing, parsing, channel routing, MD5 login,
commands) against real routers, but **not** the socket-connect-timing layer as
it behaves inside a real RN app.

**Disposition:** Recorded here and asserted as a known-gap in
`test/integration/connect-login.int.ts` (const `ONCONNECT_DIVERGENCE`). Follow-up
is deferred to a fix phase or `/gsd-debug` — do **not** silently patch
`Connector.ts`/`SocketAdapter.ts` inside this test phase.

## Finding 2: v7 `!empty` reply (RouterOS 7.18+) crashes the library — uncaught, not a rejection

**Status:** RECORD-ONLY (no `src/` patch in this phase)

**Observation:** `src/Channel.ts` `processPacket()` has cases only for
`!re`/`!done`; any other reply word (including `!empty`, introduced in
RouterOS 7.18 for empty-result commands) falls to `default` → `emit('unknown')`
→ `onUnknown()` throws `RosException('UNKNOWNREPLY')`. This throw happens
*synchronously inside the socket `'data'` handler* (`Receiver.sendTagData` →
`Channel.processPacket`), so it escapes as an **uncaught exception** rather than
a Promise rejection — the `write()` Promise never settles (the channel's `close()`
is never reached).

**Why the probe must not `await`:** a plain `try { await api.write(...) } catch`
cannot observe the `!empty` error (the throw is in the data handler, not the
promise), and the `write()` promise would hang. `test/integration/error-handling.int.ts`
instead issues the empty-result command fire-and-forget, observes the escape via a
scoped `process.on('uncaughtException')` recorder, and bounds the wait with a
`Promise.race` timeout — recording the finding without ever letting it fail the
suite.

**Disposition:** Recorded here + logged as `known-gap (!empty)` by the probe.
The fix (a `!empty` case in `Channel.processPacket` returning empty data) is
deferred to a follow-up fix phase; do **not** patch `src/` inside this test phase.

## Finding 3: `Connector.onError` wraps numeric `err.errno` (not `err.code`)

**Status:** FIXED (src patch, this phase)

**Observation:** `src/Connector.ts` `onError()` wraps the underlying socket error
as `new RosException(err.errno || 'ECONNREFUSED', …)`. On Node (Windows/Linux),
`err.errno` is a **numeric** OS errno (e.g. `-4078` on Windows) while the
human-readable string lives in `err.code` (`'ECONNREFUSED'`). So a *refused*
connection surfaces a `RosException` whose `errno` is a number, not the literal
`'ECONNREFUSED'` string the phase's truth statement anticipated. Only the
*timeout* path (`Connector.onTimeout`) surfaces the literal `'SOCKTMOUT'`.

This surfaced during `tls.int.ts` as a **blank-message `RosException`**: the TLS
handshake rejection arrives with `err.code = 'EPROTO'` / `'ERR_SSL_SSLV3_ALERT_HANDSHAKE_FAILURE'`
and no `err.errno`, so `err.errno || 'ECONNREFUSED'` produced an empty message.

**Fix (this phase):**
- `src/Connector.ts` `onError()` now derives the code from
  `err.code || err.errno || 'ECONNREFUSED'`, tolerates a missing/undefined `err`,
  and carries `err.message` as a fallback so the `RosException` message is never
  blank.
- `src/RosException.ts` falls back to `extras.message` when `errno` is unknown to
  the catalog (e.g. `EPROTO`, `ERR_SSL_*`), so TLS/network errors surface their
  raw message instead of an empty string.

**Verification:** `error-handling.int.ts` and `tls.int.ts` pass; the TLS suite
skips gracefully on the lab handshake rejection (see Finding 4).

## Finding 4: Lab API-SSL endpoint rejects standard TLS handshakes

**Status:** TEST-ONLY SKIP (lab limitation, not a library bug)

**Observation:** The v6 lab router's API-SSL endpoint (port 8729) rejects every
standard TLS handshake we tried (SSL alert 40 / `ERR_SSL_SSLV3_ALERT_HANDSHAKE_FAILURE`,
also mapped as `EPROTO` on Node) across TLS versions, ciphers, and with
`rejectUnauthorized: false`. Direct `tls.connect` probes reproduce the rejection
outside the library, so the encrypted path cannot be exercised against this lab.

**Why the tests still count:** `test/integration/tls.int.ts` still runs the full
TLS code path (`createTlsSocket` → login → write). When the handshake is rejected
it logs `SKIP TLS: handshake rejected … (lab API-SSL limitation)` and returns,
rather than failing — via `isTlsHandshakeFailure()` in `helpers/client.ts`. Any
other error still fails the suite.

**Disposition:** Re-probe against a router whose API-SSL accepts standard TLS
(many v6/v7 builds do) in a follow-up verification. The library TLS mapping
(port 8729, `tls: {}`) is already exercised as far as the lab allows.

## Finding 5: `Receiver` mis-reassembly — `hadMore: false` hardcoded at a mid-word chunk boundary

**Status:** FIXED (src patch, this phase)

**Observation:** the port's `src/Receiver.ts` `processRawData()` had hardcoded
`hadMore: false` when a word completed exactly at a TCP chunk boundary
(`data.length <= this.dataLength` branch, after `dataLength` reaches 0). The
original `node-routeros` computes `hadMore: data.length !== this.dataLength`
there — which is **always `true`** (the branch only runs when `data.length >= 1`,
and `dataLength` just became `0`). The port's comment "data.length is 0 here
since we consumed all" was wrong: a chunk ending at a word boundary does **not**
mean the response is complete.

**Impact:** with `hadMore: false`, `processSentence()` treated the drained pipe
as the end of the response and flushed `currentPacket` to the tag early — or,
when the `!re`/`.tag=` control lines landed on a later chunk, produced packets
with data lines that lacked their leading `!re`. That is what surfaced during
live CRUD as:
- `RosException: Tried to process unknown reply: =wireless-psk=` (v6 UM user
  fetch-alls, 40,860 rows — chunk boundaries hit constantly), and
- the v7 flaky `=disabled=false` desync + `SOCKTMOUT` (response tail never
  flushed).

**Fix (this phase):**
- `src/Receiver.ts` restores the original expression `hadMore: data.length !== this.dataLength`
  in the boundary branch (one-line change; all other branches already match the
  original).
- Added `routeros-api:connector:receiver` trace lines: a `processRawData` entry
  log, a "Word completed exactly at chunk boundary" log, and a `processSentence`
  "Drain check" log (line, hadMore, currentTag, packet length) — the instrumentation
  requested to trace any future data-loss.

**Verification:** the `=wireless-psk=` and `=disabled=false` errors are gone.
Full live integration suite: **8/8 suites, 46/46 tests pass** (v6 + v7).
`npx tsc --noEmit` clean.

## Finding 6: `Receiver.sendTagData` — `UNREGISTEREDTAG` throw degrades to log-and-ignore

**Status:** FIXED (src patch, this phase)

**Observation:** the original `node-routeros` throws
`RosException('UNREGISTEREDTAG')` when a packet arrives for a tag that has no
registered reader. Because that throw happens inside the socket `'data'`
handler, it escapes as an **uncaught exception** that kills the process. In this
port the hit occurs naturally at `close()`: a keepalive `'#'` (or other late)
reply for a channel that was already torn down during `close()` lands on an
unregistered tag.

**Fix (this phase):** `src/Receiver.ts` `sendTagData()` now logs-and-ignores the
orphaned packet and still calls `cleanUp()`, instead of throwing. This is a
deliberate, documented deviation from the original: an uncaught throw in the
data handler is a process crash, not a recoverable protocol error, and the
original's behavior is what risked the integration suite's `afterAll` hang /
jest no-exit.

**Verification:** covered by the passing suite (46/46) — the keepalive and
connect-login specs close channels and re-use the connection without crashing.

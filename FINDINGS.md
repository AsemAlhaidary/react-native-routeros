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

**Status:** RECORD-ONLY (no `src/` patch in this phase)

**Observation:** `src/Connector.ts` `onError()` wraps the underlying socket error
as `new RosException(err.errno || 'ECONNREFUSED', …)`. On Node (Windows/Linux),
`err.errno` is a **numeric** OS errno (e.g. `-4078` on Windows) while the
human-readable string lives in `err.code` (`'ECONNREFUSED'`). So a *refused*
connection surfaces a `RosException` whose `errno` is a number, not the literal
`'ECONNREFUSED'` string the phase's truth statement anticipated. Only the
*timeout* path (`Connector.onTimeout`) surfaces the literal `'SOCKTMOUT'`.

**Disposition:** Recorded here. `test/integration/error-handling.int.ts` accepts
both the documented string codes (`SOCKTMOUT`, `ECONNREFUSED`, …) and a numeric
OS errno so the assertion holds across platforms. The fix (`err.code` vs
`err.errno`) is deferred to a follow-up fix phase.

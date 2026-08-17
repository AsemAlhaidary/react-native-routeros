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

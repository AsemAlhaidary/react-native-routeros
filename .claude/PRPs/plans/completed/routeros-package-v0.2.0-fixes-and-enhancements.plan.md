# Plan: `react-native-routeros` v0.2.0 — Fixes & Enhancements for Full RouterOS Communication Ownership

## Summary

Close the gap between the current `0.1.0` package and what the **Wasl+ mobile app** (`wasl-plus-mobile`) requires to hand over ALL RouterOS API communication to this library. The app migration plan (`wasl-plus-mobile/.claude/PRPs/plans/routeros-library-migration.plan.md`) is **blocked on the package**, because two pieces of wire data the app depends on are dropped today: the `!done =ret=` value (created-object `.id`, read by 4 user-creation strategies) and the `!trap` attributes (`category`, read for idempotent deletes). This plan fixes those, hardens the connection lifecycle the app exercises (`close()` from two paths, `close()` during `connect()`, reconnects), adds the missing per-command timeout, exposes public connection state, moves the app's attribute/query word-building into the package (`RosCommand`), and — because the package currently ships **zero unit tests** — stands up a unit suite that locks all of the above before publishing `0.2.0`.

## User Story

As a Wasl+ maintainer (and the package author),
I want the `react-native-routeros` package to own the complete RouterOS API communication contract,
So that the app's router-connection layer becomes a thin adapter with no protocol logic, no dropped wire data (`ret`, trap attributes), and no lifecycle workarounds.

## Problem → Solution

[Dropped `!done ret` and `!trap category`; private connection state; `close()` rejecting `ALRDYCLOSNG`; `connect()` hanging when closed mid-handshake; no per-command timeout (a hung command leaks its channel); `AppState` listener leak on unexpected drops; untyped `TypeError` on write-after-close; word-building lives in the app; zero unit tests] → [v0.2.0: `writeCommand`/`WriteResult`, `RosTrapException`, `connected` accessor, idempotent close + `CANCELLED`, timeout with channel cleanup, `NOTCONNECTED`, `RosCommand`, `RosErrno`, a real unit suite, updated docs]

## Metadata

- **Package**: `react-native-routeros` — target **`0.2.0`** (0.x minor is breaking; this is a deliberate breaking-capable release)
- **Upstream**: node-routeros v1.6.8 API parity must be preserved for `write()`/`writeStream()`/`stream()`
- **Consumer**: `wasl-plus-mobile` — pins `0.2.0` after this lands; app refactor is a SEPARATE plan, not executed here
- **Estimated files**: ~12 UPDATE, ~5 CREATE, ~1 DELETE (none)
- **Baseline facts** (audited 2026-09-14, from source not README):
  - `npm test` fails today ("No tests found", `roots: ["<rootDir>/src"]`) — pre-existing gap, documented in `.planning/phases/07.../deferred-items.md`
  - Integration suite (`test/integration/*.int.ts`) is green against real v6/v7 lab routers (phase 07)
  - `RosException.errno` is a **string** key (e.g. `'CANTLOGIN'`, `'SOCKTMOUT'`), resolved to a message via `src/messages.ts`
  - `connected` / `connecting` are `private` on `RouterOSAPI` — no accessor
  - `RouterOSAPI.close()` rejects `RosException('ALRDYCLOSNG')` when already closing (`RouterOSAPI.ts:196-199`)
  - `RouterOSAPI.connect()`'s `endListener` does `if (e) reject(e)` (`RouterOSAPI.ts:95`) — a close during the handshake (pre-login) leaves the `connect()` promise **pending forever**
  - Post-login `connector.once('close')` handler does NOT remove the `AppState` subscription; only `close()` does (`RouterOSAPI.ts:130-146, 158-177`) → one leaked listener per unexpected drop
  - `Channel.write()` rejects `new Error(data.message)` on `!trap` (`Channel.ts:114`) — structured attributes dropped
  - `Channel.processPacket()` discards the parsed `!done` packet (only `this.data` / `!re` records resolve) (`Channel.ts:186-201`) — `=ret=` dropped
  - `openChannel()` does `new Channel(this.connector!)` — after a drop `connector` is `null` → `write()` after close rejects with an untyped `TypeError`

---

## Part A — Required fixes (the app is blocked without these)

### F1 · Surface the `!done =ret=` value (created-object `.id`)

**Where**: `src/Channel.ts`, `src/RouterOSAPI.ts`, `src/types.ts`

**Why**: 4 Wasl+ creation strategies read `result.value.ret` to get the created user's `.id`
(`V6/V7 Hotspot + V6/V7 UserManagerUserCreationStrategy`). Today that value never crosses the package boundary.

**Change**:
- `Channel` gains a `ret?: string` captured in `processPacket`:
  ```ts
  // in the '!done' and '!empty' branches (non-trapped):
  this.ret = parsed['ret']
  this.emit('done', this.data)
  ```
- Add `Channel.writeWithMeta(params: string[], opts?: ChannelWriteOptions): Promise<{ records: Record<string,string>[]; ret?: string }>`
  (identical to `write()` but resolves `{ records: this.data, ret: this.ret }`). `write()` keeps resolving the bare array for node-routeros parity.
- `RouterOSAPI.writeCommand()` (see E1) returns `{ records, ret, tag }`.

**Tests**: add → `Channel` resolves `ret` from `!done =ret=*3`; `ret` absent on plain print; `ret` absent when trapped.

### F2 · Preserve `!trap` attributes (`RosTrapException`)

**Where**: `src/RosTrapException.ts` (new), `src/Channel.ts`, `src/messages.ts`, `src/index.ts`

**Why**: Wasl+ `UserRepository` treats `category === 0` (missing item) as "already deleted — success" for idempotent batch deletes. A plain `Error(data.message)` loses `category`, `place`, `detail`.

**Change**:
```ts
// src/RosTrapException.ts
import { RosException } from './RosException'
export class RosTrapException extends RosException {
  readonly trapAttributes: Record<string, string>
  constructor(trapAttributes: Record<string, string>) {
    super('TRAP', { message: trapAttributes.message ?? 'RouterOS trap' })
    this.name = 'RosTrapException'
    this.trapAttributes = trapAttributes   // verbatim: category, message, place, detail
  }
}
```
- `Channel.write()` / `writeWithMeta()`: `this.once('trap', (data) => reject(new RosTrapException(data)))`.
- `messages.ts`: add `TRAP: '{{message}}'`.
- `index.ts`: export `RosTrapException`.
- `RosTrapException` must pass `instanceof Error`, `instanceof RosException`, `instanceof RosTrapException`.

**Tests**: trap on `write()` → `RosTrapException` with verbatim `trapAttributes.category`; `instanceof RosException` true; non-trap `RosException` (e.g. `SOCKTMOUT`) unchanged.

### F3 · Public connection state accessor

**Where**: `src/RouterOSAPI.ts`

**Change**:
```ts
get connected(): boolean   // socket-level truth: connecting=false, open=true, closed=false
get connecting(): boolean
```
Back them with the existing private flags (they are already maintained on every path). Document the event matrix (below) in README.

**Tests**: `connected` false before `connect()`, true after connect, false after `close()` and after an unexpected drop.

### F4 · Idempotent `close()` + abort in-flight `connect()`

**Where**: `src/RouterOSAPI.ts`, `src/messages.ts`

**Why**: Wasl+ calls `close()` from two paths (`session.close()` → bus → `api.close()` and `ConnectionRegistry.disconnect()` → `api.close()`), and may close while `connect()` is in flight (user cancels).

**Change**:
```ts
private closePromise: Promise<this> | null = null

close(): Promise<this> {
  if (this.closePromise) return this.closePromise            // never rejects a second close
  if (!this.connected && !this.connecting) {
    this.closePromise = Promise.resolve(this)
    return this.closePromise
  }
  if (this.connecting) {
    this.abortedByClose = true
    this.connector!.destroy()                                 // triggers preLoginClose below
  }
  // ...existing graceful-close path, but store the promise:
  this.closePromise = new Promise((resolve) => { /* as today */ })
  return this.closePromise
}
```
- `connect()`: `endListener` becomes `if (e) reject(e); else reject(this.abortedByClose ? new RosException('CANCELLED') : new RosException('CLOSED'))` — the promise must NEVER stay pending (today's `if (e) reject(e)` leaves it pending on pre-login close).
- Reset `this.closePromise = null` after resolve so `setOptions()+connect()` still works (CONN-05).
- `messages.ts`: add `CANCELLED: 'Connection closed by caller'`, `CLOSED: 'Connection closed before login completed'`.

**Tests**: double `close()` → both resolve, no `ALRDYCLOSNG`; `close()` before `connect()` resolves; `close()` mid-`connect()` → `connect()` rejects `CANCELLED` and settles; `setOptions()+connect()` after `close()` works.

### F5 · Per-command timeout with channel cleanup

**Where**: `src/Channel.ts`, `src/RouterOSAPI.ts`, `src/messages.ts`

**Why**: A command the router never answers hangs forever and keeps its receiver tag registered (and keeps the connection-hold `#` timer alive). Wasl+ wraps every command in a `Promise.race` today and needs a native, leak-free timeout.

**Change**:
```ts
// types.ts
export interface WriteOptions { timeoutMs?: number; signal?: AbortSignal }

// Channel.ts — timeout lives with the channel so cleanup is atomic:
writeWithMeta(params, opts?: { timeoutMs?: number; signal?: AbortSignal }) {
  // ...as write(), but:
  if (opts?.timeoutMs) {
    const timer = setTimeout(() => {
      this.close()                                      // removes tag + listeners (leak-free)
      reject(new RosException('TIMEOUT', { milliseconds: String(opts!.timeoutMs) }))
    }, opts.timeoutMs)
    // clearTimeout(timer) on resolve / trap / other reject
  }
}
```
- `messages.ts`: add `TIMEOUT: 'Command timed out after {{milliseconds}}ms'`.
- `signal`: on `aborted`, reject `RosException('CANCELLED')` and fire-and-forget `/cancel =tag=<channel.id>` (same pattern as `RStream.stop()`). Optional but included.
- Concurrent siblings unaffected (each channel is independent).

**Tests**: unanswered command → rejects `TIMEOUT` inside `timeoutMs`; receiver tag removed afterwards (no leak); sibling command still resolves; `abort()` → `CANCELLED` + `/cancel` sent.

### F6 · Fix `AppState` listener leak on unexpected drop

**Where**: `src/RouterOSAPI.ts`

**Change**: extract `removeAppStateListener()`; call it in BOTH `close()` and the post-login `connector.once('close')` drop handler (today only `close()` removes it — one leaked listener per reconnect).

**Tests**: simulate drop (emit connector `close`) → listener count for the AppState subscription returns to zero.

### F7 · Typed rejection on write after close / drop

**Where**: `src/RouterOSAPI.ts`, `src/messages.ts`

**Change**: guard `openChannel()` (single choke point for `write`/`writeCommand`/`writeStream`/`stream`):
```ts
openChannel(): Channel {
  if (!this.connector || !this.connected || this.closing) {
    throw new RosException('NOTCONNECTED')       // caught by write() → rejected promise
  }
  return new Channel(this.connector)
}
```
- `messages.ts`: add `NOTCONNECTED: 'RouterOS connection is not established'`.
- `write()` / `writeCommand()` must NOT throw synchronously: wrap `openChannel()` and return a rejected promise instead.

**Tests**: `write()` after `close()` rejects `RosException('NOTCONNECTED')` (never `TypeError`); never a pending promise.

---

## Part B — Enhancements (make the package own the whole contract)

### E1 · `writeCommand(path, params?, opts?) → Promise<WriteResult>`

```ts
// types.ts
export interface WriteResult {
  records: Record<string, string>[]
  ret?: string        // !done =ret= (created object .id)
  tag: string         // channel id, for correlation/debug
}
export interface WriteOptions { timeoutMs?: number; signal?: AbortSignal }

// RouterOSAPI.ts
writeCommand(path: string, params: string[] = [], opts: WriteOptions = {}): Promise<WriteResult>
```
- Builds words `[path, ...params]` (flat; preserves empty strings like `=comment=`; no `.tag=`, no terminator — `Channel` appends both).
- Implementation: `openChannel()` → `channel.writeWithMeta(words, opts)` → `{ records, ret, tag: channel.Id }`.
- This is the primary API Wasl+ will call; `write()` stays for node-routeros parity.

**Tests**: print → records; add → `ret` = created `.id`; remove/enable → empty records; `!empty` (v7.18+) → empty records ok; `=comment=` empty value passed verbatim.

### E2 · `RosCommand` — word builder moved out of the app

```ts
// src/RosCommand.ts (new)  + types in src/types.ts
export interface RosQueryWord { field: string; operator: '='|'<'|'>'|'?'|'-'; value?: string }
export interface RosCommandOptions {
  attributes?: Record<string, string | number | boolean | undefined>
  queries?: RosQueryWord[]
  proplist?: string[]
  label?: string         // app correlation only — package owns .tag=
  timeoutMs?: number
  preserveEmptyValues?: boolean
}
export class RosCommand {
  constructor(path: string, options?: RosCommandOptions)
  readonly path: string
  readonly label: string
  toWords(): string[]    // [path, ...]=kebab=value, =.proplist=, ?query words — NO .tag=, NO trailing ''
}
```
- Semantics byte-identical to Wasl+ `CommandContext` today: camelCase→kebab, `boolean`→`yes`/`no`, skip `undefined`, skip `''` unless `preserveEmptyValues`, `-.` query negation → `?-field`.
- The app will re-export this as its `CommandContext` so its ~25 consumers compile unchanged.
- Wire-byte guarantee (test): `RosCommand('/ip/hotspot/user/add', { attributes: { limitUptime: '1h', disabled: true }, preserveEmptyValues: true, queries: [{ field: 'name', operator: '=', value: 'x' }] }).toWords()` produces the exact expected array.

**Tests**: kebab conversion; boolean; empty-value preserved vs skipped; query operators `=`,`<`,`>`,`-`; `.proplist`; no `.tag=` / no `''` terminator.

### E3 · `RosErrno` exported constants

```ts
// src/RosErrno.ts (new)
export const RosErrno = {
  TRAP: 'TRAP', TIMEOUT: 'TIMEOUT', CANCELLED: 'CANCELLED', NOTCONNECTED: 'NOTCONNECTED',
  CANTLOGIN: 'CANTLOGIN', SOCKTMOUT: 'SOCKTMOUT', CLOSED: 'CLOSED', UNKNOWNREPLY: 'UNKNOWNREPLY',
  // ...the remaining keys in messages.ts
} as const
```
So consumers stop hardcoding magic strings. Export from `index.ts`.

### E4 · Unit test suite (new — currently the package has none)

- Add `moduleNameMapper` for `react-native` (AppState stub) and `react-native-tcp-socket` (scriptable FakeSocket) to the base jest config in `package.json` — reuse the seam pattern already proven in `test/integration/mocks/`.
- `FakeSocket`: `connect()` fires immediately, captures `write(bytes)`, exposes `emitData(bytes)`, `emitError(e)`, `emitClose()`; a byte helper wraps win1252 words into wire sentences (reuse `Transmitter`/`win1252` to produce frames, or hand-roll tiny encoder in the test helper).
- New spec files under `src/` (roots already `src`):
  - `Receiver.test.ts` — length decode, chunk-boundary reassembly, `!done ret`, `!trap category`, `!empty`, `!fatal`
  - `Channel.test.ts` — trap → `RosTrapException` attrs; `done` ret; timeout cleanup; concurrent channels; write-mutation of params
  - `Connector.test.ts` — `close`/`error`/`timeout`/`connected` event order
  - `RouterOSAPI.test.ts` — login handshake (plain + MD5 challenge), `writeCommand` ret/trap/timeout, close idempotency, close-during-connect `CANCELLED`, write-after-close `NOTCONNECTED`, connected accessor, AppState listener cleanup
  - `RosCommand.test.ts` — word building matrix (E2)
  - `RosException.test.ts` — message catalog substitution, `RosTrapException` instanceof chain
- Delete the `deferred-items.md` entry after the suite exists.

### E5 · Docs + behavior contract

- `README.md`: event matrix (see F3), `connected`/`connecting`, `writeCommand`, trap attributes, timeout semantics, idempotent close, `NOTCONNECTED`, TLS self-signed trust note.
- `docs/API.md`: document the new surface and the "never leaves a pending promise" contract.

---

## Files to Change

### CREATE
| File | Purpose |
|---|---|
| `src/RosTrapException.ts` | F2 |
| `src/RosCommand.ts` | E2 |
| `src/RosErrno.ts` | E3 |
| `src/__tests__/Receiver.test.ts` (or `src/**/__tests__/`) | E4 |
| `src/__tests__/Channel.test.ts` | E4 |
| `src/__tests__/Connector.test.ts` | E4 |
| `src/__tests__/RouterOSAPI.test.ts` | E4 |
| `src/__tests__/RosCommand.test.ts` | E4 |
| `src/__tests__/RosException.test.ts` | E4 |
| `test/unit/mocks/react-native.ts` | E4 (AppState stub) |
| `test/unit/mocks/react-native-tcp-socket.ts` | E4 (FakeSocket) |

### UPDATE
| File | Change |
|---|---|
| `src/Channel.ts` | F1 (`ret` capture, `writeWithMeta`), F2 (`RosTrapException`), F5 (timeout+cleanup) |
| `src/RouterOSAPI.ts` | F1 (`writeCommand`), F3 (accessors), F4 (idempotent close / CANCELLED / never-pending connect), F5 (timeout wiring), F6 (AppState leak), F7 (NOTCONNECTED guard), E1 |
| `src/Connector.ts` | None expected (verify event-order tests only) |
| `src/RosException.ts` | None expected (subclass uses existing catalog path) |
| `src/messages.ts` | F2/F4/F5/F7 keys: `TRAP`, `TIMEOUT`, `CANCELLED`, `CLOSED`, `NOTCONNECTED` |
| `src/types.ts` | `WriteResult`, `WriteOptions`, `RosCommandOptions`, `RosQueryWord` |
| `src/index.ts` | Export `RosTrapException`, `RosCommand`, `RosErrno`, new types |
| `package.json` | Jest `moduleNameMapper` for unit tests; version → `0.2.0` |
| `README.md`, `docs/API.md` | E5 |
| `.planning/phases/07-.../deferred-items.md` | Mark unit-suite gap resolved |

## NOT Building

- No changes to the app repo (that is the follow-up `routeros-library-migration.plan.md` execution).
- No auto-reconnect helper — Wasl+ keeps its AppState-driven reconnect; `setOptions()+connect()` already covers manual reconnect.
- No `keepaliveBy` change — Wasl+ keeps its own 60s keepalive; the library feature stays as-is.
- No TLS certificate pinning — `react-native-tcp-socket` cannot verify; self-signed acceptance is documented, not changed.
- No `stream()`/`writeStream()` changes — untouched; the app does not use continuous endpoints.

---

## Step-by-Step Tasks

### M1 — Unit-test harness (before behavior changes)
1. Add jest `moduleNameMapper` (E4 mocks) to `package.json`; create `test/unit/mocks/{react-native.ts,react-native-tcp-socket.ts}`.
2. Write `Receiver.test.ts` + `RosException.test.ts` to lock **current** framing/error behavior.
3. **VALIDATE**: `npm test` goes green (first time ever); `npm run typecheck` clean.

### M2 — Trap + ret (F1, F2, E3)
4. `RosTrapException` + messages `TRAP`; switch `Channel.write()` to reject it.
5. Capture `Channel.ret` from `!done`/`!empty`; add `writeWithMeta`.
6. `RouterOSAPI.writeCommand` + `WriteResult`/`WriteOptions`.
7. `Channel.test.ts` (trap attrs, ret, concurrency) + `RouterOSAPI.test.ts` (writeCommand ret/trap).
8. **VALIDATE**: unit + `npm run typecheck` + `npm run build`.

### M3 — Lifecycle robustness (F3, F4, F6, F7)
9. `connected`/`connecting` accessors; never-pending `connect()` (CANCELLED/CLOSED).
10. Idempotent `close()` (store/reset `closePromise`); `close()` mid-connect aborts.
11. AppState listener cleanup on drop; `openChannel()` NOTCONNECTED guard.
12. `RouterOSAPI.test.ts` additions (close matrix, drop, AppState leak, write-after-close).
13. **VALIDATE**: unit + typecheck + build.

### M4 — Per-command timeout + abort (F5)
14. `writeWithMeta` timeout with channel cleanup; `TIMEOUT` message; `signal` → `/cancel`.
15. Fake-timer unit tests (unanswered → `TIMEOUT`, tag removed, sibling unaffected, abort → `CANCELLED`).
16. **VALIDATE**: unit + typecheck + build.

### M5 — Command builder + exports (E2, E3, E5)
17. `RosCommand` + `RosCommandOptions`/`RosQueryWord`; `RosErrno`; export from `index.ts`.
18. `RosCommand.test.ts` matrix.
19. README/API docs: event matrix, new surface, contracts, TLS note.
20. **VALIDATE**: unit + typecheck + build.

### M6 — Release readiness
21. Run the full real-router integration suite (`npm run test:integration`) against the v6 (192.168.187.128:8728) and v7 (192.168.187.130:8175) lab boxes.
22. Extend integration specs with assertions for: `writeCommand` returns created `.id` (add flows), trap rejects `RosTrapException` with category, `!done ret` on remove/disable is empty, `close()` double-call safe.
23. Bump version → `0.2.0`; `npm run build`; update `deferred-items.md`.
24. **VALIDATE**: `npm test`, `npm run typecheck`, `npm run build`, `npm run test:integration` all green.

---

## Testing Strategy

### Unit (new, in `src/`)
| Area | Input | Expected |
|---|---|---|
| Receiver framing | split byte chunks across word/descriptor boundaries | correct sentence reassembly |
| Channel trap | `!trap category=0 message="no such item"` | rejects `RosTrapException` with verbatim attrs |
| Channel done | `!re =name=x` + `!done =ret=*3` | resolves `{ records:[{name:'x'}], ret:'*3' }` |
| Channel timeout | never answers, `timeoutMs: 50` (fake timers) | rejects `RosException('TIMEOUT')`; receiver tag removed |
| Concurrent channels | 2 writes, one times out | sibling still resolves; no cross-talk |
| RouterOSAPI close | double close / close before connect / close mid-connect | never `ALRDYCLOSNG`; `connect()` settles `CANCELLED` |
| RouterOSAPI drop | connector `close` emitted | `connected` false; AppState listener removed |
| RouterOSAPI write-after-close | `writeCommand` on closed api | rejects `RosException('NOTCONNECTED')` |
| RosCommand | attrs/queries/proplist/preserveEmptyValues | exact word array, no `.tag=`/terminator |
| RosException | catalog substitution; subclass instanceof | `RosTrapException` instanceof Error+RosException |

### Integration (existing suite + extensions, real routers)
- Login v6 (MD5 challenge) + v7 (fast path) — existing
- CRUD create/disable/delete — extend to assert `.id` non-empty from `writeCommand` and trap category on re-delete
- `close()` double-call during a live session — no crash, subsequent `connect()` works

## Validation Commands
```bash
npm test                    # unit suite — GREEN (was "No tests found")
npm run typecheck           # tsc --noEmit — clean
npm run build               # bob build + plugin — artifacts regenerate
npm run test:integration    # real v6/v7 lab suite — GREEN + new ret/trap/close assertions
```

## Acceptance Criteria
- [ ] `writeCommand` resolves `{ records, ret }`; `ret` is the created `.id` on add flows (verified on real routers)
- [ ] `!trap` rejects `RosTrapException` with verbatim `trapAttributes` (`category` intact)
- [ ] `connected`/`connecting` public and correct on every lifecycle path
- [ ] `close()` never rejects; `close()` during `connect()` aborts and `connect()` always settles
- [ ] per-command `timeoutMs` rejects `TIMEOUT` and leaves no receiver tag behind
- [ ] `write()`/`writeCommand()` after close reject `RosException('NOTCONNECTED')` — never `TypeError`
- [ ] no `AppState` listener leaks across reconnect/drop cycles
- [ ] `RosCommand.toWords()` matches Wasl+ `CommandContext` byte-for-byte (no `.tag=`, no terminator)
- [ ] `npm test` green with the new unit suite; integration suite green on v6 + v7
- [ ] version `0.2.0`; README/API docs updated; `deferred-items.md` unit-gap marked resolved

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `ret`/trap shape differs on some RouterOS build | Medium | High | M6 integration assertions on both v6/v7; `WriteResult` is additive so shape can evolve without breaking `write()` |
| Timeout cleanup races a late real reply | Low | Low | Receiver already degrades gracefully on unregistered tags (orphaned packet ignored) |
| `close()`-during-`connect()` edge untested on device | Low | Medium | M3 unit tests cover the promise settlement; M6 adds a live double-close check |
| Node-routeros parity drift in `write()` | Low | Low | `write()` keeps its exact resolved-array contract; new behavior lives only in additive APIs |
| Unit FakeSocket diverges from real RN-TCP timing | Low | Low | Unit suite covers logic; real timing validated by the integration suite |

## Notes
- **Backward compatibility rule**: `write()`, `writeStream()`, `stream()`, event names, and `RouterOSAPI` constructor options keep their `0.1.0` shapes. All fixes are additive or make invalid states settle correctly (a pending promise → a typed rejection is a fix, not a break).
- The app migration (`wasl-plus-mobile/.claude/PRPs/plans/routeros-library-migration.plan.md`) is the only consumer of the new surface: `writeCommand`, `RosTrapException`, `connected`, `RosCommand`, `RosErrno`, timeout, idempotent close.
- After `0.2.0` publishes, the app pins `^0.2.0` and deletes its facade compensation code (no `withTimeout`, no trap duck-typing, no `rejectAll` machinery).
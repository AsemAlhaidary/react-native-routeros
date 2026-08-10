---
phase: 04-robustness-lifecycle
plan: 04
subsystem: core
tags: [events, lifecycle, appstate, react-native, error-handling, tcp]

# Dependency graph
requires:
  - phase: 03-commands-streaming
    provides: RouterOSAPI write/writeStream/stream/keepaliveBy public API
provides:
  - Post-login persistent close listener with full state cleanup
  - !fatal protocol error propagation as distinct 'fatal' event
  - Socket drop detection with consumer-facing 'close' event
  - React Native AppState listener for background/foreground lifecycle
  - State consistency guard against missed close events during JS suspension
affects: [verification, integration-testing, expo-config]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Event-driven connection lifecycle: Connector close emits reason via once() on RouterOSAPI"
    - "JS suspension recovery: AppState consistency check (connected && !connector) detects missed events"
    - "Minimal RN type shims: declare only the API surface used, avoid full react-native devDependency"

key-files:
  created:
    - src/types/react-native.d.ts - Minimal type declarations for RN AppState API
  modified:
    - src/RouterOSAPI.ts - Post-login close/fatal/error listeners, AppState listener, cleanup
    - src/Connector.ts - onEnd(reason?) signature, fatal reason propagation, socket wiring

key-decisions:
  - "onEnd(reason?: 'fatal') signature — enables consumer to distinguish router-side !fatal from network drops"
  - "Persistent on('error') not once('error') post-login — socket may emit multiple errors before destroy"
  - "No automatic reconnect on foreground — consumer owns reconnection decision, receives 'close' event"
  - "No socket teardown on background — RouterOS sessions can survive brief backgrounds"
  - "Minimal react-native.d.ts instead of react-native devDependency — avoids ~200MB install for 3 type signatures"

patterns-established:
  - "Close-as-cleanup-hook: RouterOSAPI.once('close') handler mirrors close() cleanup (stopStreams, clearTimers, nullConnector)"
  - "State consistency guard: AppState change → if connected && !connector → emit close (missed-event recovery)"

requirements-completed: [ERR-02, LIFE-01, LIFE-02]

# Coverage metadata
coverage:
  - id: D1
    description: "Post-login close listener cleans up RouterOSAPI state (connected, streams, timers, connector) on socket close/fatal"
    requirement: "LIFE-02"
    verification:
      - kind: unit
        ref: "npx tsc --noEmit"
        status: pass
    human_judgment: true
    rationale: "Event-driven lifecycle requires integration testing with a live RouterOS device — unit types alone cannot verify runtime event ordering"

  - id: D2
    description: "!fatal protocol errors emit distinct 'fatal' event on RouterOSAPI before consumer-facing 'close'"
    requirement: "ERR-02"
    verification:
      - kind: unit
        ref: "npx tsc --noEmit"
        status: pass
    human_judgment: true
    rationale: "!fatal reception and event propagation require live RouterOS integration test — types verify wiring but not protocol-level behavior"

  - id: D3
    description: "React Native AppState listener detects background/foreground transitions and recovers from missed close events"
    requirement: "LIFE-01"
    verification:
      - kind: unit
        ref: "npx tsc --noEmit"
        status: pass
    human_judgment: true
    rationale: "AppState lifecycle behavior (JS suspension, event queuing) requires real RN runtime — type-checking confirms wiring but not runtime semantics"

# Metrics
duration: 14min
completed: 2026-08-10
status: complete
---

# Phase 4 Plan 4: Connection Lifecycle Hardening Summary

**!fatal protocol error propagation, persistent post-login close/error listeners, and React Native AppState background/foreground awareness**

## Performance

- **Duration:** ~14 min
- **Started:** 2026-08-10T16:53:28Z
- **Completed:** 2026-08-10T17:07:23Z
- **Tasks:** 2
- **Files modified:** 3 (1 created, 2 modified)

## Accomplishments

- Connector `onEnd()` now accepts optional `reason?: 'fatal'` parameter, enabling RouterOSAPI to distinguish router-side !fatal shutdowns from network-level socket drops
- Post-login connection lifecycle listeners replace the previous fragile `once('error')`/`once('timeout')` pattern with a persistent `once('close')` that does full state cleanup and emits `'fatal'` + `'close'` events
- !fatal protocol errors (ERR-02) now emit a distinct `'fatal'` event on RouterOSAPI before the consumer-facing `'close'` — consumers can handle router-side shutdowns differently from network blips
- React Native AppState listener (LIFE-01) registered on connect, removed on close; performs state consistency check on every AppState change to detect missed close events during JS suspension
- All three close scenarios (!fatal, socket drop, background-kill) handled with a single consumer pattern: `api.on('close', () => api.connect())`

## Task Commits

Each task was committed atomically:

1. **Task 1: RouterOSAPI post-login close listener + !fatal event propagation** - `7f93500` (feat)
2. **Task 2: RouterOSAPI React Native AppState lifecycle listener** - `5f0d7ae` (feat)

## Files Created/Modified

- `src/Connector.ts` - `onEnd(reason?: 'fatal')` signature, socket close/fatal wiring updated (both TLS and TCP branches)
- `src/RouterOSAPI.ts` - Post-login close handler with full cleanup, persistent error/timeout listeners, AppState listener with state consistency guard
- `src/types/react-native.d.ts` - Minimal type declarations for AppState and AppStateStatus (avoids full `react-native` devDependency)

## Decisions Made

- **`onEnd(reason?: 'fatal')` signature** — enables consumer to distinguish router-side !fatal from network drops without adding a separate event
- **Persistent `on('error')` not `once('error')` post-login** — a dying socket may emit multiple errors before destroy; each should be surfaced
- **No automatic reconnect on foreground** — consumer owns the reconnection decision; the library emits `'close'` and the consumer decides
- **No socket teardown on background** — RouterOS sessions can survive brief backgrounding; forcibly closing would break active streams
- **Minimal `react-native.d.ts` shim** — declares only the 3 types RouterOSAPI uses, avoiding a ~200MB `react-native` devDependency for type-checking alone

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed Connector socket `close` event type incompatibility with new `onEnd` signature**
- **Found during:** Task 2 (type-checking gate)
- **Issue:** RN-TCP's socket `close` event passes `(had_error: boolean)`, but `onEnd` was updated to accept `(reason?: 'fatal')`. The `this.onEnd.bind(this)` reference caused TS2345: "Type 'boolean' is not assignable to type '"fatal"'".
- **Fix:** Changed `this.socket.once('close', this.onEnd.bind(this))` to `this.socket.once('close', () => this.onEnd())` on both TLS and TCP branches. The `had_error` boolean from RN-TCP is unused — the `close` event is sufficient to trigger cleanup.
- **Files modified:** `src/Connector.ts` (lines 86, 107)
- **Verification:** `npx tsc --noEmit` passes with zero errors
- **Committed in:** `5f0d7ae` (part of Task 2 commit)

**2. [Rule 3 - Blocking] Created minimal `react-native` type declarations for compilation**
- **Found during:** Task 2 (type-checking gate)
- **Issue:** `import { AppState, AppStateStatus } from 'react-native'` failed with TS2307 — `react-native` is not installed as a devDependency (the library expects it as a peer dependency from consumers)
- **Fix:** Created `src/types/react-native.d.ts` with minimal `declare module 'react-native'` declaring only the `AppState`, `AppStateStatus`, and `AppStateStatic.addEventListener` types used by RouterOSAPI
- **Files modified:** `src/types/react-native.d.ts` (new file)
- **Verification:** `npx tsc --noEmit` passes with zero errors; import resolves correctly
- **Committed in:** `5f0d7ae` (part of Task 2 commit)

---

**Total deviations:** 2 auto-fixed (1 bug, 1 blocking)
**Impact on plan:** Both auto-fixes were necessary for type-safe compilation. No scope creep — both changes maintain the plan's documented behavior exactly.

## Issues Encountered

None — the execution was straightforward once the type compatibility and module resolution issues were resolved.

## User Setup Required

None — no external service configuration required. The `react-native.d.ts` type shim is self-contained.

## Next Phase Readiness

- All three lifecycle events (fatal, close, AppState) are wired and type-checked
- Consumer can handle connection loss with `api.on('close', () => { api.setOptions(opts); api.connect(); })`
- Ready for Phase 5: build/packaging and integration testing with a live RouterOS device

---
*Phase: 04-robustness-lifecycle*
*Completed: 2026-08-10*

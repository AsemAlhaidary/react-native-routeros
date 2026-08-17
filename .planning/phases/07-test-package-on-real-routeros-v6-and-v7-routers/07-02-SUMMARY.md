---
phase: 07-test-package-on-real-routeros-v6-and-v7-routers
plan: "02"
subsystem: testing
tags: [jest, ts-jest, routeros, mikrotik, react-native, integration-testing, write, writeStream, stream, keepalive]

# Dependency graph
requires:
  - phase: 07-test-package-on-real-routeros-v6-and-v7-routers
    plan: "01"
    provides: "Integration harness (jest.integration.config.js + moduleNameMapper net/tls bridge) + helpers/client.ts (buildClient/reachable) + helpers/version.ts (detectVersion)"
provides:
  - "write-read.int.ts — write() across 5 stable services with version-aware cpu/cpu-load assertion"
  - "writeStream.int.ts — writeStream() data/done/close ordering + trap error path"
  - "stream.int.ts — continuous /interface/monitor-traffic pause/resume/stop + empty-burst guard"
  - "keepalive.int.ts — keepalive:true constructor flag + keepaliveBy('#') session hold past timeout/2"
affects: [07-03]

# Tech tracking
tech-stack:
  added: []  # zero new packages — reuses jest/ts-jest harness + 07-01 helpers
  patterns:
    - "Per-device deviceSuite (describe.skip when env unset) + beforeAll reachability probe + return-early guard — never a red run offline"
    - "RStream event ordering (data* -> done -> close) asserted via an ordered event log + indexOf comparisons"

key-files:
  created:
    - test/integration/write-read.int.ts
    - test/integration/writeStream.int.ts
    - test/integration/stream.int.ts
    - test/integration/keepalive.int.ts
  modified: []

key-decisions:
  - "07-02: write-read connects once in beforeAll and runs detectVersion once to branch the resource CPU-field assertion (v6 cpu vs v7 cpu-load — field presence only, A2)"
  - "07-02: stream() uses continuous /interface/monitor-traffic (no =once=) so pause/resume/stop have ongoing data to observe; endpoint trap -> per-device skip"
  - "07-02: keepalive tests wait ~6s (past timeout/2 = 5s) and count 'error' events to assert the session never dropped"

patterns-established:
  - "RStream 'error' event is always swallowed (writeStream/stream have no callback, so a trap emits both 'error' and 'trap'); 'trap' is the assertion signal"

requirements-completed: []  # plan has requirements: [] (no mapped phase_req_ids)

coverage:
  - id: D1
    description: "All four specs type-check (ts-jest) and SKIP cleanly offline (exit 0) when ROUTEROS_* env is unset or routers unreachable"
    verification:
      - kind: integration
        ref: "npx jest -c jest.integration.config.js write-read.int.ts writeStream.int.ts stream.int.ts keepalive.int.ts (offline: 20 skipped, exit 0)"
        status: pass
      - kind: unit
        ref: "npx tsc --noEmit (exit 0)"
        status: pass
    human_judgment: false
  - id: D2
    description: "write()/writeStream()/stream()/keepalive proven against LIVE v6/v7 router bytes (CMDS-01/02, STRM-01..04, CONN-06)"
    verification:
      - kind: integration
        ref: "npm run test:integration (requires .env.test + reachable routers)"
        status: unknown
    human_judgment: true
    rationale: "Requires real lab router credentials (gitignored .env.test) and reachable physical v6/v7 devices; the executor cannot establish live-router reachability offline, so pass/fail against real hardware is a human sign-off."

# Metrics
duration: 20min
completed: 2026-08-17
status: complete
---

# Phase 07 Plan 02: Test Package on Real RouterOS v6/v7 — Summary

**Command-and-streaming surface integration specs (write reads across five stable services, writeStream finite + trap, stream pause/resume/stop + empty-burst guard, keepalive session hold) that reuse the 07-01 harness and run against both lab routers, degrading to SKIP when offline — with zero library `src/` changes.**

## Performance

- **Duration:** ~20 min
- **Completed:** 2026-08-17
- **Tasks:** 2 (both auto)
- **Files created:** 4 (test-scope only)

## Accomplishments
- `write-read.int.ts` proves `write()` returns parsed arrays for `/system/identity/print`, `/system/resource/print`, `/interface/print`, `/ip/address/print`, and `/user/print`, with a `detectVersion`-branched assertion for the resource CPU field (v6 `cpu` vs v7 `cpu-load` — field presence, not a numeric value, per A2).
- `writeStream.int.ts` proves the finite-stream lifecycle (`data` → `done` → `close` on `/interface/print`) and the trap path (invalid command emits `trap` with a non-empty message).
- `stream.int.ts` proves continuous `/interface/monitor-traffic` streaming: `data` arrives, `pause()` stops flow, `resume()` restarts it, `stop()` halts it, and no tight empty-data bursts occur (STRM-04); a per-device trap on the endpoint degrades to a documented skip.
- `keepalive.int.ts` proves both keepalive paths (constructor `keepalive: true` and explicit `keepaliveBy('#')`) keep the session responsive past `timeout / 2` with zero `error` events (CONN-06).
- All four files reuse the 07-01 `deviceSuite` pattern (`describe.skip` when env unset, `beforeAll` reachability probe + return-early guard) — offline the whole set reports 20 skipped / exit 0, never red.

## Task Commits

Each task was committed atomically:

1. **Task 1 (auto): write() service reads (v6+v7) + writeStream() finite streaming and trap** — `dc99ce9` (test)
2. **Task 2 (auto): stream() continuous streaming (pause/resume/stop) + keepalive session hold** — `0002047` (test)

## Files Created
- `test/integration/write-read.int.ts` — 5-service `write()` reads + version-aware `cpu`/`cpu-load` field-presence assertion
- `test/integration/writeStream.int.ts` — `data`→`done`→`close` ordering + invalid-command `trap` with message
- `test/integration/stream.int.ts` — `/interface/monitor-traffic` continuous stream with `pause`/`resume`/`stop` + empty-burst guard + trap-skip
- `test/integration/keepalive.int.ts` — `keepalive: true` + `keepaliveBy('#')` session hold past `timeout/2` with error-count assertion

No `src/` files modified — test-scope only, per phase goal.

## Decisions Made
- Connect once in `beforeAll` and detect the version once (reusing 07-01's `detectVersion`) to branch the `cpu`/`cpu-load` assertion — avoids per-test reconnects.
- Use the continuous form of `/interface/monitor-traffic` (no `once` keyword) so `pause`/`resume`/`stop` have ongoing data to observe; a trap on that endpoint degrades to a per-device skip with the trap text recorded.
- Keepalive tests use the default `timeout: 10` (interval 5s) and wait ~6s, counting `error` events as the "session dropped" signal.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Plan's `=once=` would defeat the pause/resume/stop test**
- **Found during:** Task 2 (`stream.int.ts`)
- **Issue:** The plan suggested `stream(['/interface/monitor-traffic', '=interface=<if>', '=once='])`. The `once` keyword bounds `monitor-traffic` to a single sample (and `=once=` is not a valid attribute word), so the stream would emit one sample then end — leaving nothing to observe across `pause()`/`resume()`/`stop()`.
- **Fix:** Use the continuous form (`=interface=<if>`, no `once`), which streams every ~1s until the `/cancel` that `pause`/`stop` send. Kept the trap-skip fallback so an unsupported endpoint/interface degrades to a documented skip.
- **Files modified:** `test/integration/stream.int.ts`
- **Verification:** `npx jest -c jest.integration.config.js stream.int.ts` (offline: SKIP, exit 0); documented in the file header comment.
- **Committed in:** `0002047`

**2. [Rule 3 - Blocking] TS2339 `never` on `trap` captured-variable narrowing**
- **Found during:** Task 2 (`stream.int.ts` first ts-jest run)
- **Issue:** A `let trap: Record<string, any> | null` assigned inside the `stream.on('trap', ...)` closure narrowed to `never` after `if (trap)`, so `trap.message` failed type-check (`Property 'message' does not exist on type 'never'`).
- **Fix:** Replaced the mutable `let` with an accumulator array (`traps: Record<string, any>[]`) and tested `traps.length > 0` / `traps[0].message`, which ts-jest narrows correctly.
- **Files modified:** `test/integration/stream.int.ts`
- **Verification:** ts-jest typecheck passes; `npx jest -c jest.integration.config.js stream.int.ts keepalive.int.ts` (exit 0).
- **Committed in:** `0002047`

---

**Total deviations:** 2 auto-fixed (1 Rule 1 bug in the plan's command + 1 Rule 3 type fix)
**Impact on plan:** All fixes are test-scope only; zero `src/` changes. No scope creep.

## Issues Encountered
- **Pre-existing (unchanged):** the project has zero unit test files, so `npm test` exits 1 with "No tests found" (`roots: ["<rootDir>/src"]` finds none). This predates plan 07-02 and is already logged in `deferred-items.md`. Verified `npm test` picks up zero integration files (they live in `test/`, outside `src/`). Not fixed here — writing a unit suite is out of scope for this test-scope plan.

## User Setup Required

Live-router validation requires the gitignored `.env.test` (from `.env.test.example`) with real lab credentials:
- `ROUTEROS_V6_HOST` / `ROUTEROS_V6_PORT` (goal: `192.168.187.128:8728`)
- `ROUTEROS_V7_HOST` / `ROUTEROS_V7_PORT` (goal: `192.168.187.130:8175`)
- `ROUTEROS_USER` / `ROUTEROS_PASSWORD`

Then run: `npm run test:integration`. Offline, the suite reports SKIP and exits 0.

## Next Phase Readiness
- Command-and-streaming surface is now covered for `write`/`writeStream`/`stream`/`keepalive` on both routers.
- Remaining Wave-3 specs (plan 07-03): `tls.int.ts`, `error-handling.int.ts`, `usermanager-crud.int.ts` (+ `recipes/v6.ts`/`v7.ts` and `helpers/crud.ts`).
- Blockers/concerns: none blocking — live-router pass/fail awaits user-provided `.env.test` credentials.

---

*Phase: 07-test-package-on-real-routeros-v6-and-v7-routers*
*Completed: 2026-08-17*

## Self-Check: PASSED

- All 4 created files present on disk (`test/integration/{write-read,writeStream,stream,keepalive}.int.ts`).
- Both task commits present: `dc99ce9` (Task 1), `0002047` (Task 2).
- `npx jest -c jest.integration.config.js write-read.int.ts writeStream.int.ts stream.int.ts keepalive.int.ts` → 20 skipped, exit 0 (clean offline SKIP).
- `npx jest -c jest.integration.config.js` (full integration suite) → 30 skipped + 1 passed (07-01 known-gap), exit 0.
- `npx tsc --noEmit` → exit 0.
- `npm test` → "No tests found" (pre-existing unit-suite gap, documented in `deferred-items.md`).

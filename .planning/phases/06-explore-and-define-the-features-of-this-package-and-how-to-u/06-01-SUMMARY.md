---
phase: 06-explore-and-define-the-features-of-this-package-and-how-to-u
plan: 01
subsystem: docs
tags: [react-native-routeros, routeros, mikrotik, api-reference, examples, typescript, node-routeros]

# Dependency graph
requires:
  - phase: 05-build-types-docs-expo-plugin
    provides: [built library with shipped types, README, Expo config plugin]
provides:
  - "Canonical source-grounded end-to-end example (examples/basic-usage.ts)"
  - "Complete API/feature reference for all 20 public exports (docs/API.md)"
affects: [06-02 (docs/EXAMPLES.md, docs/INSTALLATION.md, README docs section)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Source-grounded documentation: every doc field/method/event copied verbatim from src/, never invented"

key-files:
  created:
    - examples/basic-usage.ts
    - docs/API.md
  modified: []

key-decisions:
  - "Example uses placeholder credentials ('admin'/'password') with an explicit comment to use env vars / secure key store — intentional per threat-model T-06-01, not a stub"
  - "docs/API.md organized by subsystem (types → RouterOSAPI → RStream → lower-level classes → errors → codec/utils → transport) mirroring src/index.ts export grouping"

patterns-established:
  - "Docs pattern: an 'at a glance' export table up front, then per-subsystem sections with exact field/method tables"

requirements-completed: []  # Phase 6 has no mapped requirement IDs (ROADMAP "Requirements: none")

# Coverage metadata (#1602)
coverage:
  - id: D1
    description: "Source-grounded end-to-end example (examples/basic-usage.ts) exercising connect → (internal login) → write('/system/resource/print') → close using only the real RouterOSAPI public surface"
    requirement:
    verification:
      - kind: other
        ref: "grep: from 'react-native-routeros' import + api.connect()/api.write('/system/resource/print')/api.close() each present once; no Node Buffer/net/tls/stream"
        status: pass
    human_judgment: false
  - id: D2
    description: "Full API/feature reference (docs/API.md) covering all 20 public exports with exact field/method/event names from src/"
    verification:
      - kind: other
        ref: "grep: all 20 export names (RouterOSAPI, RStream, Channel, Connector, Transmitter, Receiver, RosException, messages, decodeWin1252, encodeWin1252, md5Hash, debounce, createPlainSocket, createTlsSocket, IRosOptions, TlsRnOptions, IRosGenericResponse, ConnectorOptions, RosSocket, CreateSocketOptions) present"
        status: pass
    human_judgment: false

# Metrics
duration: 7 min
completed: 2026-08-17
status: complete
---

# Phase 06 Plan 01: Canonical example + API reference Summary

**Source-grounded connect → login → write → close example (`examples/basic-usage.ts`) plus a complete API reference (`docs/API.md`) covering all 20 public exports of react-native-routeros, every name copied verbatim from src/.**

## Performance

- **Duration:** 7 min
- **Started:** 2026-08-17T18:11:00Z
- **Completed:** 2026-08-17T18:18:20Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- `examples/basic-usage.ts` walks the single happy path (connect → internal login → write → close) using only the real `RouterOSAPI` public surface, with `RosException` error handling and placeholder credentials.
- `docs/API.md` documents every public export named in `src/index.ts` (20 exports), organized by subsystem, with exact field/method/event names — including the explicit statement that `connect()` performs login internally (no public login method).
- Both artifacts are grounded in `src/` — no invented API surface, no Node built-ins in the example, and TLS/plain-TCP security behavior documented per the plan's threat model.

## Task Commits

Each task was committed atomically:

1. **Task 1: End-to-end "connect → login → write → close" example (tracer)** - `8e1b0aa` (docs)
2. **Task 2: Feature/API reference covering every public export in src/index.ts** - `0fff829` (docs)

**Plan metadata:** `docs(06-01): complete [plan-name] plan` — committed with STATE.md / ROADMAP.md metadata (see final commit below)

## Files Created/Modified
- `examples/basic-usage.ts` - Canonical happy-path example: `connect()` → `write('/system/resource/print')` → `close()`, wrapped in try/catch with `RosException` errno/message, placeholder credentials
- `docs/API.md` - Complete API/feature reference: export table + per-subsystem sections (types, RouterOSAPI, RStream, lower-level classes, errors, codec/utils, transport) + security notes

## Decisions Made
- Example uses placeholder credentials (`admin`/`password`) with an explicit comment to use environment variables / a secure key store — this is the intended mitigation for threat-model T-06-01, not a stub.
- `docs/API.md` is organized by subsystem mirroring `src/index.ts` export grouping, with an "at a glance" export table up front for fast scanning.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Tracer example (`examples/basic-usage.ts`) is ready to anchor 06-02's broader scenario coverage (`docs/EXAMPLES.md`).
- `docs/API.md` is ready to be linked from the README Documentation section in 06-02.
- No blockers.

---

*Phase: 06-explore-and-define-the-features-of-this-package-and-how-to-u*
*Completed: 2026-08-17*

## Self-Check: PASSED

- [x] `examples/basic-usage.ts` exists on disk
- [x] `docs/API.md` exists on disk
- [x] `06-01-SUMMARY.md` exists on disk
- [x] Task 1 commit `8e1b0aa` present in git log
- [x] Task 2 commit `0fff829` present in git log
- [x] Plan-level verification: import surface + connect/write/close all present in example; all 20 public export names present in API.md

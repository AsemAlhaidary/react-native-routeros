---
phase: 06-explore-and-define-the-features-of-this-package-and-how-to-u
plan: 02
subsystem: docs
tags: [react-native-routeros, routeros, mikrotik, examples, installation, expo, typescript, node-routeros]

# Dependency graph
requires:
  - phase: 06-explore-and-define-the-features-of-this-package-and-how-to-u
    provides: [canonical end-to-end example (examples/basic-usage.ts), full API/feature reference (docs/API.md)]
provides:
  - "Real-world scenario recipes covering the full public command surface (docs/EXAMPLES.md)"
  - "End-to-end installation guide for Bare RN + Expo custom dev client (docs/INSTALLATION.md)"
  - "README Documentation section linking all four deeper guides"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Source-grounded documentation: every example call and install command copied from src/ + package.json + plugin/src/*, never invented"

key-files:
  created:
    - docs/EXAMPLES.md
    - docs/INSTALLATION.md
  modified:
    - README.md

key-decisions:
  - "docs/EXAMPLES.md uses placeholder credentials ('admin'/'password') with an explicit env-var/secure-key-store note — intentional per threat-model T-06-01, not a stub"
  - "docs/EXAMPLES.md organized as 12 scenario sections (connect+error, read, write config, monitoring stream, torch, pause/resume/stop, concurrent, keepalive, reconnection, RN lifecycle, TLS, error handling) plus a writeStream section and a full program — mirroring the plan's required scenario list"
  - "docs/INSTALLATION.md structured as dual-path (Bare RN → Expo custom dev client), with config-plugin behavior described verbatim from plugin/src/withAndroid.ts and withIos.ts (Android throws on missing tcp-socket + INTERNET/cleartextTraffic; iOS non-fatal warning)"

patterns-established:
  - "Docs pattern: EXAMPLES.md = one scenario per heading with a minimal runnable snippet; INSTALLATION.md = prerequisites → per-target steps → config-plugin behavior → verification"

requirements-completed: []  # Phase 6 has no mapped requirement IDs (ROADMAP "Requirements: none")

# Metrics
duration: 5 min
completed: 2026-08-17
status: complete
---

# Phase 06 Plan 02: Scenario recipes + installation guide + README links Summary

**Real-world scenario recipes (`docs/EXAMPLES.md`) covering the full public command surface, an end-to-end installation guide (`docs/INSTALLATION.md`) for Bare RN + Expo custom dev client, and a README `Documentation` section linking all four deeper guides — every call and command grounded in the shipped API.**

## Performance

- **Duration:** 5 min
- **Started:** 2026-08-17T15:24:26Z
- **Completed:** 2026-08-17T15:28:49Z
- **Tasks:** 3
- **Files modified:** 3 (2 created, 1 modified)

## Accomplishments
- `docs/EXAMPLES.md` delivers 12 real-world scenarios (connect+error, read resources, write config, monitoring stream, torch stream with the `(err, packet, stream)` callback, pause/resume/stop, concurrent commands, keepalive, reconnection, RN lifecycle, TLS, error handling via errno → messages catalog) plus a `writeStream` section and a full program. Every method call matches `src/RouterOSAPI.ts` / `src/RStream.ts`, no public login method is referenced, and TLS uses `tls: {}` / `tls: { ca }` per `src/Connector.ts`.
- `docs/INSTALLATION.md` documents both install paths: Bare RN (`npm install react-native-routeros` → peer deps → `pod install` → rebuild) and Expo custom dev client (`npm install react-native-routeros react-native-tcp-socket` → `plugins` array → `npx expo prebuild` → `npx expo run:ios`/`run:android`), with an explicit Expo Go "NOT supported" warning and config-plugin behavior described from `plugin/src/*`.
- `README.md` gains a `Documentation` section after the Usage content, linking `docs/INSTALLATION.md`, `docs/API.md`, `docs/EXAMPLES.md`, and `examples/basic-usage.ts` — existing Installation and Usage sections preserved verbatim.

## Task Commits

Each task was committed atomically:

1. **Task 1: Real-world scenario recipes grounded in the shipped API** - `7e2a194` (docs)
2. **Task 2: Installation process guide for Bare RN and Expo custom dev client** - `e631db7` (docs)
3. **Task 3: Link the documentation from README** - `9902a76` (docs)

## Files Created/Modified
- `docs/EXAMPLES.md` - 12 scenario recipes + writeStream + full program, all grounded in the real public API with placeholder credentials and no Node built-ins
- `docs/INSTALLATION.md` - prerequisites + Bare RN + Expo custom dev client paths + config plugin behavior + verification, matching package.json and plugin/src/*
- `README.md` - appended `## Documentation` section with four relative links (existing Installation/Usage preserved)

## Decisions Made
- Placeholder credentials (`admin`/`password`) throughout, with an explicit env-var/secure-key-store note — the intended T-06-01 mitigation, not a stub.
- `docs/EXAMPLES.md` mirrors the plan's required scenario list one-heading-per-scenario, with a `writeStream` section and a full program for completeness.
- `docs/INSTALLATION.md` config-plugin section describes Android (throws + INTERNET + cleartextTraffic) and iOS (non-fatal warning) behavior verbatim from the plugin source.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None. (`rg` was unavailable on this Windows host, so the `<verify>` grep checks were run via `Select-String` / the Grep tool, which produced equivalent counts: EXAMPLES.md command surface = 25 matches, INSTALLATION.md install paths = 13 matches, README.md doc links = 4 matches.)

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Phase 6 documentation deliverable set is now complete: `examples/basic-usage.ts`, `docs/API.md`, `docs/EXAMPLES.md`, `docs/INSTALLATION.md`, and the README Documentation section.
- No blockers.

---

*Phase: 06-explore-and-define-the-features-of-this-package-and-how-to-u*
*Completed: 2026-08-17*

## Self-Check: PASSED

- [x] `docs/EXAMPLES.md` exists on disk
- [x] `docs/INSTALLATION.md` exists on disk
- [x] `README.md` contains `## Documentation` with all four links
- [x] Task 1 commit `7e2a194` present in git log
- [x] Task 2 commit `e631db7` present in git log
- [x] Task 3 commit `9902a76` present in git log
- [x] Phase-level verification: EXAMPLES.md command surface (25), INSTALLATION.md install paths (13), README.md doc links (4)

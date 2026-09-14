# Deferred Items — Phase 07

Out-of-scope discoveries logged during execution (not caused by this phase's
changes; acknowledged and carried forward).

| Category | Item | Status | Discovered At |
|----------|------|--------|---------------|
| pre-existing | The project has **zero unit test files** (`roots: ["<rootDir>/src"]` finds no `.test.ts`/`.spec.ts`); `npm test` exits 1 with "No tests found". The plan's "existing unit suite stays green" assumes a unit suite that was never authored in phases 1–6. Plan 07-01 correctly keeps integration tests out of `src/` (verified: `npm test` picks up zero integration files), but the unit suite itself remains a pre-existing gap. | resolved | 07-01 |

**Resolution (v0.2.0, PRP `routeros-package-v0.2.0-fixes-and-enhancements`):** a real unit suite now ships under `src/__tests__/` (Receiver, Channel, Connector, RouterOSAPI, RosCommand, RosException) with `moduleNameMapper` entries for `react-native` and `react-native-tcp-socket` (FakeSocket) in `test/unit/mocks/`. `npm test` is green (50 tests). See `.claude/PRPs/reports/routeros-package-v0.2.0-fixes-and-enhancements-report.md`.

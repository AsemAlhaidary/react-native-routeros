# Deferred Items — Phase 07

Out-of-scope discoveries logged during execution (not caused by this phase's
changes; acknowledged and carried forward).

| Category | Item | Status | Discovered At |
|----------|------|--------|---------------|
| pre-existing | The project has **zero unit test files** (`roots: ["<rootDir>/src"]` finds no `.test.ts`/`.spec.ts`); `npm test` exits 1 with "No tests found". The plan's "existing unit suite stays green" assumes a unit suite that was never authored in phases 1–6. Plan 07-01 correctly keeps integration tests out of `src/` (verified: `npm test` picks up zero integration files), but the unit suite itself remains a pre-existing gap. | open | 07-01 |

---
phase: 05-build-types-docs-expo-plugin
plan: 01
subsystem: build
tags: [react-native-builder-bob, typescript, exports, peerDependencies, package.json]

# Dependency graph
requires:
  - phase: 04-robustness-lifecycle
    provides: full src/ tree (RouterOSAPI, Connector, RStream, Receiver, Transmitter, etc.) ready to compile
provides:
  - builder-bob build pipeline emitting dual CJS/ESM + .d.ts into lib/
  - publish-ready package.json (exports react-native condition, files, source, peerDependencies)
affects: [05-02-readme, 05-03-expo-plugin]

# Tech tracking
tech-stack:
  added: [react-native-builder-bob]
  patterns: [builder-bob dual module/commonjs/typescript targets, flat exports react-native source condition]

key-files:
  created: []
  modified: [package.json, package-lock.json, .planning/REQUIREMENTS.md]

key-decisions:
  - "types field + exports['.'].types point at ./lib/typescript/module/index.d.ts (builder-bob 0.43.0 actual output, not STACK.md's stale lib/typescript/src/ path)"
  - "Flat exports shape (types/react-native/import/require) retained per BUILD-03 despite builder-bob's non-fatal warning preferring nested import.types/require.types"
  - "react-native-tcp-socket intentionally dual-listed in dependencies + peerDependencies (autolink + version pin)"

patterns-established:
  - "builder-bob targets [module(esm), commonjs(esm), typescript] produce lib/module, lib/commonjs, lib/typescript/{module,commonjs}"

requirements-completed: [TYPE-01, BUILD-01, BUILD-02, BUILD-03, BUILD-04, BUILD-05]

coverage:
  - id: D1
    description: "builder-bob build emits dual CJS (lib/commonjs) + ESM (lib/module) + shipped .d.ts (lib/typescript)"
    requirement: BUILD-02
    verification:
      - kind: other
        ref: "npm run build && node -e existence check for lib/module/index.js, lib/commonjs/index.js, lib/typescript/module/index.d.ts, lib/typescript/commonjs/index.d.ts"
        status: pass
    human_judgment: false
  - id: D2
    description: "Zero Node API usage in src (tsc --noEmit strict + grep guard for net/tls/crypto/fs/stream imports and bare Buffer/process.)"
    requirement: BUILD-01
    verification:
      - kind: other
        ref: "npx tsc --noEmit (exit 0) + Select-String grep guard over src/**/*.ts (no matches in code)"
        status: pass
    human_judgment: false
  - id: D3
    description: "package.json exports react-native source condition + types/import/require, plus files/source/react-native fields"
    requirement: BUILD-03
    verification:
      - kind: other
        ref: "node -e require ./package.json and assert exports['.'].react-native === ./src/index.ts etc."
        status: pass
    human_judgment: false
  - id: D4
    description: "peerDependencies (react, react-native, react-native-tcp-socket) + exactly 4 runtime deps"
    requirement: BUILD-04
    verification:
      - kind: other
        ref: "node -e assert peerDeps + exact 4 dependency keys (debug, events, js-md5, react-native-tcp-socket)"
        status: pass
    human_judgment: false

# Metrics
duration: 10min
completed: 2026-08-17
status: complete
---

# Phase 5 Plan 1: Build, Types, Docs + Expo Plugin — Build Pipeline Summary

**builder-bob dual CJS/ESM + .d.ts build pipeline and a publish-ready package.json exports contract**

## Performance

- **Duration:** 10 min
- **Started:** 2026-08-17T16:35:58Z
- **Completed:** 2026-08-17T16:46:05Z
- **Tasks:** 3
- **Files modified:** 3 (package.json, package-lock.json, REQUIREMENTS.md)

## Accomplishments

- `npm run build` (via `bob build`) emits `lib/module` (ESM), `lib/commonjs` (CJS), and `lib/typescript/{module,commonjs}` (shipped `.d.ts`) from the 15-file `src/` tree — zero errors
- `npx tsc --noEmit` passes with `strict: true`, plus a grep guard confirms zero Node API usage in `src/` (no `net`/`tls`/`crypto`/`fs`/`stream` imports, no bare `Buffer`/`process.`)
- package.json now declares `exports["."]` with a `react-native` source condition (`./src/index.ts`) plus `types`/`import`/`require` conditions, `files`, `source`, and `react-native` fields
- `peerDependencies` declares `react`, `react-native`, `react-native-tcp-socket`; `dependencies` holds exactly the 4 runtime deps (`debug`, `events`, `js-md5`, `react-native-tcp-socket`)

## Task Commits

Each task was committed atomically:

1. **Task 1 (tracer): Wire builder-bob dual CJS/ESM + types build** - `4a5fdd2` (feat)
2. **Task 2: Add exports react-native source condition + publish contract fields** - `95c85a6` (feat)
3. **Task 3: Declare peerDependencies + verify minimal runtime deps** - `cd54759` (feat)

**Plan metadata:** (docs commit issued after state updates)

## Files Created/Modified

- `package.json` - added builder-bob config block + devDep, real `build` script, `exports`/`files`/`source`/`react-native` fields, `peerDependencies`; corrected stale `types` path
- `package-lock.json` - updated by `npm install react-native-builder-bob@^0.43.0`
- `.planning/REQUIREMENTS.md` - reconciled BUILD-05 text to list all 4 runtime deps (added `debug`)

## Decisions Made

- Corrected the `types` field and `exports["."].types` to `./lib/typescript/module/index.d.ts` — builder-bob 0.43.0 emits `.d.ts` under `lib/typescript/module/` and `lib/typescript/commonjs/`, not `lib/typescript/src/` as STACK.md/plan assumed
- Retained the flat `exports` shape (`types` + `react-native` + `import` + `require`) per BUILD-03, accepting builder-bob's non-fatal warning that prefers nested `import.types`/`require.types`
- `react-native-tcp-socket` dual-listed in `dependencies` (autolinking) and `peerDependencies` (version pin) — deliberate per plan

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed stale `types` field path for builder-bob 0.43.0 output layout**
- **Found during:** Task 1 (tracer — `npm run build` failed)
- **Issue:** builder-bob 0.43.0 emits `.d.ts` to `lib/typescript/module/` and `lib/typescript/commonjs/`, not `lib/typescript/src/`. The plan/STACK.md assumed `./lib/typescript/src/index.d.ts`, so `npm run build` failed with "types field points to a non-existent file". The same stale path was also planned for `exports["."].types` in Task 2.
- **Fix:** Changed the top-level `types` field and `exports["."].types` to `./lib/typescript/module/index.d.ts` (both files verified to exist after build).
- **Files modified:** package.json
- **Verification:** `npm run build` exits 0; `lib/typescript/module/index.d.ts` and `lib/typescript/commonjs/index.d.ts` both exist.
- **Committed in:** `4a5fdd2` (Task 1) and `95c85a6` (Task 2)

---

**Total deviations:** 1 auto-fixed (Rule 1 - bug)
**Impact on plan:** The path correction is required for the build to pass at all; no scope creep, contract intent (dual CJS/ESM + shipped .d.ts + react-native source condition) unchanged.

## Issues Encountered

- `npm install react-native-builder-bob` reported 7 high-severity audit findings — all in build-tooling devDependencies (transitive), not runtime deps, and out of scope for this plan (no publish in scope).
- builder-bob emits two non-fatal warnings: (1) `compilerOptions.outDir` in tsconfig.json conflicts with builder-bob's CLI `--outDir` (tsconfig is not in this plan's scope and is left as-is); (2) flat `exports["."].types` + flat `import`/`require` — accepted because the flat shape is the explicit BUILD-03 contract.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `lib/` outputs are reproducible via `npm run build`; package.json is a publish-ready contract
- 05-02 (README) and 05-03 (Expo config plugin) can now build on the `exports`/`files`/`peerDependencies` contract established here

---

## Self-Check: PASSED

- `05-01-SUMMARY.md` — FOUND
- `lib/module/index.js` — FOUND (build output, gitignored)
- `lib/commonjs/index.js` — FOUND (build output, gitignored)
- `lib/typescript/module/index.d.ts` — FOUND (build output, gitignored)
- `lib/typescript/commonjs/index.d.ts` — FOUND (build output, gitignored)
- Commit `4a5fdd2` — FOUND (Task 1)
- Commit `95c85a6` — FOUND (Task 2)
- Commit `cd54759` — FOUND (Task 3)

---
*Phase: 05-build-types-docs-expo-plugin*
*Completed: 2026-08-17*

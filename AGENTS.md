<!-- GSD:project-start source:PROJECT.md -->

## Project

**react-native-routeros**

A TypeScript library that brings the `node-routeros` API to React Native, letting RN apps talk directly to MikroTik RouterOS devices over the RouterOS API protocol (raw TCP). It is a from-scratch TypeScript rewrite built on the same structure, code style, and usage API as the original `node-routeros` v1.6.8 (compiled `dist/` is the reference), targeting both Bare React Native and Expo (custom dev clients via config plugins + prebuilds).

**Core Value:** A React Native app can `connect` to a MikroTik router, log in (RouterOS v6/v7), and issue `write` / `writeStream` / `stream` commands with the exact same developer experience as `node-routeros` — no Node.js runtime required.

### Constraints

- **Compatibility**: Must run on React Native (Bare + Expo custom dev client) — no Node.js runtime APIs; only RN-safe replacements.
- **Tech stack**: TypeScript, mirroring original module structure and public API; consumer types shipped.
- **Dependencies**: Keep runtime deps minimal; prefer pure-JS RN-safe implementations over Node-only packages.
- **Compatibility**: API parity with node-routeros v1.6.8 usage (`RouterOSAPI` constructor options, `write`/`writeStream`/`stream` signatures, event names, callback shapes).
- **Environment**: Local-only for now — no GitHub/npm publishing in scope for this phase set.

<!-- GSD:project-end -->

<!-- GSD:stack-start source:research/STACK.md -->

## Technology Stack

## Runtime Dependencies

| Library | Version | Purpose | Rationale | Confidence |
|---------|---------|---------|-----------|------------|
| `react-native-tcp-socket` | `^6.4.2` | Raw TCP + TLS socket transport | Mirrors Node `net`/`tls` API exactly: `createConnection()`/`connectTLS()` with options callback, `on('data')`, `write()`, `destroy()`, `setTimeout()`, `setNoDelay()`. Built-in TypeScript types. Supports self-signed CA certs (RouterOS default). Published 15 days ago — actively maintained. Only viable raw-TCP native module for RN. | **HIGH** |
| `js-md5` | `^0.9.2` | MD5 challenge-response login | Zero dependencies, built-in TS types. Natively accepts `Uint8Array` and `ArrayBuffer` — critical because RouterOS login challenge is binary byte concatenation (`0x00` + password bytes + challenge hash), not UTF-8 strings. Also provides streaming API (`md5.create().update().hex()`) and HMAC. Fastest synchronous JS MD5 per benchmarks. Published 21 days ago, actively maintained. | **HIGH** |
| `events` | `^3.3.0` | EventEmitter base class | Node.js 11.13.0-compatible EventEmitter polyfill for environments without Node core `events`. Zero dependencies, 74M weekly downloads. RN's built-in EventEmitter is deprecated and has a different API — never use it. For TS types, either install `@types/events` or define a local `EventEmitter` interface matching the subset we use (`on`, `once`, `emit`, `removeListener`, `removeAllListeners`). | **HIGH** |
| `debug` | `^4.4.3` | Namespaced debug logging | Same as original node-routeros dependency. Works in RN (browser-compatible since v4). Uses `DEBUG=routeros:*` env var convention. 685M weekly downloads. | **HIGH** |

### win1252 Encoding — No Dependency

## Build Dependencies

| Library | Version | Purpose | Rationale | Confidence |
|---------|---------|---------|-----------|------------|
| `typescript` | `~5.9.0` | TypeScript compiler | TS 7.0 just shipped (5 hours ago), but RN ecosystem tooling lags — `@react-native/typescript-config`, Metro, and builder-bob are tested against TS 5.x. Use `~5.9.0` (latest 5.x) for stability. TS 5.9 has all modern features we need (satisfies, const type params, ECMAScript decorators). | **HIGH** |
| `react-native-builder-bob` | `^0.43.0` | Build tool for RN libraries | Callstack's standard build tool for React Native libraries. Compiles TS source to both ESM `module` and CJS `commonjs` targets, generates `.d.ts` declarations. 311K weekly downloads. Init: `npx react-native-builder-bob@latest init`. | **HIGH** |
| `@types/react-native` | `*` | RN type definitions | Required for `devDependencies` to reference RN types in library code. Not needed at runtime, only for compilation. | **MEDIUM** |

### builder-bob Configuration

### tsconfig Target

- **`target: "esnext"`** — RN's Hermes engine supports ES2022+ features. builder-bob's Babel pass handles transpilation to the right target for each platform.
- **`moduleResolution: "bundler"`** — Required for Metro compatibility; avoids file extension issues in imports.
- **`strict: true`** — Full type safety from day one. The original node-routeros had no strict mode.

## Dev Dependencies

| Library | Version | Purpose | Rationale | Confidence |
|---------|---------|---------|-----------|------------|
| `jest` | `^30` | Test framework | Default for RN libraries. `@types/jest` for TS integration. Replaces mocha+chai from original. | **MEDIUM** |
| `prettier` | `^3.0` | Code formatting | Original used prettier v2; upgrade to v3.x (current stable line). | **HIGH** |
| `eslint` | `^9` | Linting | Flat config format (ESLint 9+). Use `@react-native/eslint-config` or a tailored config. | **MEDIUM** |
| `@types/debug` | `^4.1` | Type definitions for `debug` | debug v4.4.3 ships without built-in types; needs this. Original used very old `@types/debug@0.0.30`. | **HIGH** |
| `@types/node` | `^22` | Node types for build tooling | Needed for builder-bob + jest tooling, not runtime. Original used `@types/node@12`. | **LOW** |

## Expo Config Plugin

## Dev Tools

| Tool | Version | Purpose | Rationale | Confidence |
|------|---------|---------|-----------|------------|
| `tsx` | `^4` | Run TS files directly | Alternative to `ts-node`; execute test scripts or build tooling in TS without compilation. | **LOW** |

## What NOT to Use

| Rejected | Reason |
|----------|--------|
| **`spark-md5`** instead of `js-md5` | No built-in TS types (needs `@types/spark-md5`), last published 5 years ago, slightly larger API surface. `js-md5` has native `Uint8Array` support in the main API without needing `SparkMD5.ArrayBuffer` subclass. |
| **`iconv-lite`** for win1252 | Node-centric (uses `Buffer` internally), ~130KB install, may break in Hermes/bundler. A custom 128-entry lookup table is ~1.5KB, 0 deps, and perfectly correct for RouterOS protocol which only uses the win1252 subset. |
| **`crypto-js`** for MD5 | Much larger (~400KB), complex API, overkill for just MD5. `js-md5` is purpose-built. |
| **`metro-minify-terser` config changes** | Not needed — builder-bob handles minification via its Babel pipeline. |
| **RN's built-in `EventEmitter` from `react-native`** | Deprecated, different API surface (`addListener`/`remove`), not compatible with node-routeros event patterns (`on`/`emit`/`once`). Use `events` npm package. |
| **`expo-module-scripts` for building** | Expo-specific toolchain that adds `expo` as a peer dependency. Over-commits the library to Expo ecosystem. `react-native-builder-bob` is the standard for all RN libraries, Expo-compatible via config plugin but not Expo-required. |
| **`node_modules` — any Node built-in** | `net`, `tls`, `crypto`, `Buffer`, `stream` are completely unavailable in RN. All dependencies have been explicitly replaced above. |

## Recommendations

## Sources

- `react-native-tcp-socket` npm page + README (npmjs.com, 2026-08-10) — v6.4.2, full `net`/`tls` API surface documented
- `js-md5` npm page (npmjs.com, 2026-08-10) — v0.9.2, Uint8Array/ArrayBuffer support confirmed
- `spark-md5` npm page (npmjs.com, 2026-08-10) — v3.0.2, ArrayBuffer via subclass, no built-in TS types
- `events` npm page (npmjs.com, 2026-08-10) — v3.3.0, Node 11.13.0 API match
- `react-native-builder-bob` npm + docs (npmjs.com / callstack docs, 2026-08-10) — v0.43.0, build target config
- Expo Config Plugins docs (docs.expo.dev, 2026-08-10) — plugin structure, `app.plugin.js` entry, library development patterns
- `typescript` npm page (npmjs.com, 2026-08-10) — v7.0.2 latest, v5.9.x recommended for RN ecosystem
- `debug` npm page (npmjs.com, 2026-08-10) — v4.4.3, browser/RN compatible
- React Native TypeScript docs (reactnative.dev, 2026-08-10) — `@react-native/typescript-config` reference
- Unicode Consortium Windows-1252 mapping (well-known standard) — 27 characters differ in 0x80–0x9F range

<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->

## Conventions

Conventions not yet established. Will populate as patterns emerge during development.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->

## Architecture

Architecture not yet mapped. Follow existing patterns found in the codebase.
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->

## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, `.github/skills/`, or `.codex/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->

## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:

- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->

<!-- GSD:profile-start -->

## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->

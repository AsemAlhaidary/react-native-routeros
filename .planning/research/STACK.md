# Stack Research — react-native-routeros

**Project:** React Native port of node-routeros (MikroTik RouterOS API client)
**Researched:** 2026-08-10
**Overall confidence:** HIGH

## Runtime Dependencies

| Library | Version | Purpose | Rationale | Confidence |
|---------|---------|---------|-----------|------------|
| `react-native-tcp-socket` | `^6.4.2` | Raw TCP + TLS socket transport | Mirrors Node `net`/`tls` API exactly: `createConnection()`/`connectTLS()` with options callback, `on('data')`, `write()`, `destroy()`, `setTimeout()`, `setNoDelay()`. Built-in TypeScript types. Supports self-signed CA certs (RouterOS default). Published 15 days ago — actively maintained. Only viable raw-TCP native module for RN. | **HIGH** |
| `js-md5` | `^0.9.2` | MD5 challenge-response login | Zero dependencies, built-in TS types. Natively accepts `Uint8Array` and `ArrayBuffer` — critical because RouterOS login challenge is binary byte concatenation (`0x00` + password bytes + challenge hash), not UTF-8 strings. Also provides streaming API (`md5.create().update().hex()`) and HMAC. Fastest synchronous JS MD5 per benchmarks. Published 21 days ago, actively maintained. | **HIGH** |
| `events` | `^3.3.0` | EventEmitter base class | Node.js 11.13.0-compatible EventEmitter polyfill for environments without Node core `events`. Zero dependencies, 74M weekly downloads. RN's built-in EventEmitter is deprecated and has a different API — never use it. For TS types, either install `@types/events` or define a local `EventEmitter` interface matching the subset we use (`on`, `once`, `emit`, `removeListener`, `removeAllListeners`). | **HIGH** |
| `debug` | `^4.4.3` | Namespaced debug logging | Same as original node-routeros dependency. Works in RN (browser-compatible since v4). Uses `DEBUG=routeros:*` env var convention. 685M weekly downloads. | **HIGH** |

### win1252 Encoding — No Dependency

The RouterOS API protocol encodes all string fields as Windows-1252. Rather than pulling in `iconv-lite` (Node-centric, ~130KB, may have RN compatibility issues) or a `text-encoding` polyfill (overkill), the correct approach is a **zero-dependency custom 128-byte lookup table**.

Windows-1252 is identical to ASCII for bytes 0x00–0x7F. The 0x80–0x9F range differs from ISO-8859-1 in only 27 code points. A static `Uint8Array(128)` lookup table + two small functions (`encodeWin1252(str) → Uint8Array`, `decodeWin1252(bytes) → string`) totals ~1.5KB minified and is fully testable.

```typescript
// encode: char → win1252 byte
function encodeWin1252(str: string): Uint8Array {
  const result = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) {
    const cp = str.charCodeAt(i);
    result[i] = cp < 0x80 ? cp : (WIN1252_FROM_UNICODE[cp - 0x80] ?? 0x3F); // '?' for unmappable
  }
  return result;
}
// decode: win1252 byte → char
function decodeWin1252(bytes: Uint8Array): string {
  let result = '';
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    result += b < 0x80 ? String.fromCharCode(b) : String.fromCharCode(WIN1252_TO_UNICODE[b - 0x80] ?? b);
  }
  return result;
}
```

This mirrors exactly what `iconv-lite` does for win1252 in the original code. **Confidence: HIGH** — the mapping tables are well-documented Unicode Consortium standards.

## Build Dependencies

| Library | Version | Purpose | Rationale | Confidence |
|---------|---------|---------|-----------|------------|
| `typescript` | `~5.9.0` | TypeScript compiler | TS 7.0 just shipped (5 hours ago), but RN ecosystem tooling lags — `@react-native/typescript-config`, Metro, and builder-bob are tested against TS 5.x. Use `~5.9.0` (latest 5.x) for stability. TS 5.9 has all modern features we need (satisfies, const type params, ECMAScript decorators). | **HIGH** |
| `react-native-builder-bob` | `^0.43.0` | Build tool for RN libraries | Callstack's standard build tool for React Native libraries. Compiles TS source to both ESM `module` and CJS `commonjs` targets, generates `.d.ts` declarations. 311K weekly downloads. Init: `npx react-native-builder-bob@latest init`. | **HIGH** |
| `@types/react-native` | `*` | RN type definitions | Required for `devDependencies` to reference RN types in library code. Not needed at runtime, only for compilation. | **MEDIUM** |

### builder-bob Configuration

In `package.json`:

```json
{
  "react-native-builder-bob": {
    "source": "src",
    "output": "lib",
    "targets": [
      ["module", { "esm": true }],
      ["commonjs", { "esm": true }],
      "typescript"
    ]
  },
  "main": "./lib/commonjs/index.js",
  "module": "./lib/module/index.js",
  "types": "./lib/typescript/src/index.d.ts",
  "exports": {
    ".": {
      "import": {
        "types": "./lib/typescript/module/src/index.d.ts",
        "default": "./lib/module/index.js"
      },
      "require": {
        "types": "./lib/typescript/commonjs/src/index.d.ts",
        "default": "./lib/commonjs/index.js"
      }
    }
  },
  "files": [
    "lib",
    "src",
    "app.plugin.js",
    "plugin/build"
  ]
}
```

### tsconfig Target

```json
{
  "compilerOptions": {
    "target": "esnext",
    "module": "esnext",
    "moduleResolution": "bundler",
    "declaration": true,
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "lib",
    "rootDir": "src"
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "lib", "**/__tests__/*"]
}
```

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

For Expo CNG (Continuous Native Generation) compatibility, a config plugin must be shipped:

**`app.plugin.js`** (root):
```js
module.exports = require('./plugin/build');
```

**`plugin/src/index.ts`**:
```typescript
import { type ConfigPlugin, withPlugins } from 'expo/config-plugins';
import { withAndroidPlugin } from './withAndroid';
import { withIosPlugin } from './withIos';

const withReactNativeRouterOS: ConfigPlugin<{}> = (config) => {
  return withPlugins(config, [withAndroidPlugin, withIosPlugin]);
};

export default withReactNativeRouterOS;
```

**Consumer's `app.json`**:
```json
{
  "expo": {
    "plugins": ["react-native-routeros"]
  }
}
```

Since `react-native-tcp-socket` already autolinks via RN 0.60+ autolinking, the Expo config plugin is minimal — it exists primarily as a marker that the library explicitly supports Expo CNG. The plugin can add any needed Android permissions (`INTERNET` is already default) or iOS entries. If no modifications are needed, the plugin simply returns the config unchanged.

**Confidence: HIGH** — this follows the exact Expo library plugin pattern from `expo/config-plugins` documentation.

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

1. **Keep runtime deps at 4 packages**: `react-native-tcp-socket`, `js-md5`, `events`, `debug`. Everything else is build-time or handled inline (win1252).
2. **Bundle size**: Total runtime deps < 50KB gzipped. The win1252 table adds ~1.5KB inline.
3. **TypeScript first**: Ship `.d.ts` declarations via builder-bob's `typescript` target. Consumers get full IntelliSense.
4. **Expo config plugin is minimal**: Since `react-native-tcp-socket` autolinks, the plugin mainly signals CNG compatibility. Add platform-specific config only if needed (e.g., custom Android permissions beyond INTERNET).
5. **Test strategy**: Use Jest with `ts-jest` for unit tests. Socket-level integration tests can use `react-native-tcp-socket`'s server mode on localhost.

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

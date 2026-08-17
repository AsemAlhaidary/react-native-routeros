---
phase: 06-explore-and-define-the-features-of-this-package-and-how-to-u
fixed_at: 2026-08-17T21:11:38+03:00
review_path: D:/Projects/GitHub/react-native-routeros/.planning/phases/06-explore-and-define-the-features-of-this-package-and-how-to-u/06-REVIEW.md
iteration: 1
findings_in_scope: 3
fixed: 3
skipped: 0
status: all_fixed
---

# Phase 06: Code Review Fix Report

**Fixed at:** 2026-08-17T21:11:38+03:00
**Source review:** `06-REVIEW.md`
**Iteration:** 1

**Summary:**
- Findings in scope: 3 (CR-01, WR-01, WR-02)
- Fixed: 3
- Skipped: 0

## Fixed Issues

### CR-01: Documented TLS port auto-selection (port 8729) does not happen

**Files modified:** `docs/API.md`, `docs/EXAMPLES.md`, `README.md`
**Commit:** `8ddde69`
**Applied fix:** Docs-only correction (source left unchanged to preserve node-routeros v1.6.8 parity).

Checked the reference implementation at `node-routeros/dist/RouterOSAPI.js` — its `setOptions()` runs `this.port = options.port || 8728` with **no** TLS check, and `connect()` always passes that explicit value to the `Connector`. The `Connector`'s `if (!options.port) this.port = 8729` branch is therefore dead when driven from `RouterOSAPI`. The original does **not** auto-select 8729 at the `RouterOSAPI` level, so our source (`src/RouterOSAPI.ts:66` and `src/Connector.ts`) is already faithful — this is a documentation defect, not a parity bug.

Removed the "TLS auto-selects 8729" wording from:
- `docs/API.md:49` (`IRosOptions.port` default now `8728`; note says TLS requires explicit `port: 8729`)
- `docs/API.md:83,85` (`ConnectorOptions.port`/`tls` rows now document that object-form `tls` selects 8729 only when `port` is omitted, and `tls: true` leaves the port at 8728)
- `docs/EXAMPLES.md` §11 TLS example now passes `port: 8729` explicitly
- `README.md` TLS example now passes `port: 8729` explicitly

### WR-01: `react-native-tcp-socket` dual-listed in dependencies + peerDependencies

**Files modified:** `package.json`
**Commit:** `38464ff`
**Applied fix:** Removed `react-native-tcp-socket` from `dependencies`, keeping it peer-only in `peerDependencies`. This aligns `package.json` with the existing docs (which already describe it as a peer dependency that "must be installed yourself"), and avoids the native-module duplicate-copy anti-pattern for an autolinked module.

`dependencies` is now `{ debug, events, js-md5 }`; `peerDependencies` remains `{ react, react-native, react-native-tcp-socket }`.

### WR-02: Error-handling examples treat `write()` traps as `RosException`

**Files modified:** `docs/EXAMPLES.md`, `examples/basic-usage.ts`, `docs/INSTALLATION.md`, `README.md`
**Commit:** `a147b89`
**Applied fix:** Corrected the error-handling examples to distinguish the two error classes honestly. A command `!trap` rejects with a plain `Error` (`.message` only) — confirmed in `src/Channel.ts:77-79` (`reject(new Error(data.message))`) — while `connect()`/login/socket failures reject with `RosException` (`errno`).

- `docs/EXAMPLES.md` §12 retitled "distinguish RosException from command traps"; errno→messages lookup now demonstrated on a `connect()` failure, and a `write()` trap shown as a plain `Error`.
- `examples/basic-usage.ts` split into separate `connect()` (RosException) and `write()` (plain `Error`) try/catch blocks.
- `docs/INSTALLATION.md` verification snippet split the same way.
- `README.md:109` corrected: `write()` now described as rejecting with a plain `Error` on `!trap` (was "rejects with a `RosException`").

---

_Fixed: 2026-08-17T21:11:38+03:00_
_Fixer: the agent (gsd-code-fixer)_
_Iteration: 1_

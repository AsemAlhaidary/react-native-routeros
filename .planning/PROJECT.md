# react-native-routeros

## What This Is

A TypeScript library that brings the `node-routeros` API to React Native, letting RN apps talk directly to MikroTik RouterOS devices over the RouterOS API protocol (raw TCP). It is a from-scratch TypeScript rewrite built on the same structure, code style, and usage API as the original `node-routeros` v1.6.8 (compiled `dist/` is the reference), targeting both Bare React Native and Expo (custom dev clients via config plugins + prebuilds).

## Core Value

A React Native app can `connect` to a MikroTik router, log in (RouterOS v6/v7), and issue `write` / `writeStream` / `stream` commands with the exact same developer experience as `node-routeros` — no Node.js runtime required.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] Rewrite the node-routeros API in TypeScript from the compiled `dist/` reference: `RouterOSAPI`, `Channel`, `RStream`, `RosException`, `messages`, `utils`, `IRosOptions`, `IRosGenericResponse`
- [ ] Replace Node-only socket layer (`net`/`tls`) with `react-native-tcp-socket` for raw TCP + TLS
- [ ] Replace Node `crypto` MD5 login challenge with a pure-JS MD5 implementation
- [ ] Replace `iconv-lite` win1252 protocol encoding with a small pure-JS encoder
- [ ] Maintain full parity with node-routeros feature surface: connect, login (v6+v7), write/writeStream, stream (RStream / listen), keepalive, close, error mapping
- [ ] Make the library installable in any Bare RN project or Expo project (config plugin / prebuild friendly)
- [ ] Support TypeScript consumers with shipped type definitions
- [ ] Document the library (README with usage examples, API reference)

### Out of Scope

- **Expo Go compatibility** — Expo Go cannot run raw TCP without native modules; requires custom dev client. Explicitly dropped by user decision.
- **RouterOS WebSocket API transport** — the protocol requires pure TCP; WebSocket API is a different RouterOS feature, not part of this port.
- **GitHub / npm publishing** — deferred; build + document locally first (user decision for v1).

## Context

- Reference library: `node-routeros` v1.6.8 (MIT, author Aluisio Rodrigues Amaral, repo `aluisiora/node-routeros`). Only the compiled `dist/` exists locally (no TypeScript `src/`); source maps point at `../src/*.ts` which is not included.
- `dist/` layout: `index.js` (exports), `RouterOSAPI.js`, `Channel.js`, `RStream.js`, `RosException.js`, `messages.js`, `utils.js`, `IRosOptions.js`, `IRosGenericResponse.js`, `connector/{Connector,Receiver,Transmitter}.js`, plus `.d.ts` for every module.
- **Architecture (from dist analysis):**
  - `RouterOSAPI extends EventEmitter` — main entry; owns `Connector`, channel bookkeeping, login (MD5 challenge-response using `crypto.createHash('MD5')`), `write`, `writeStream`, `stream`, `keepaliveBy`, `close`, `setOptions`, `openChannel`.
  - `Connector extends EventEmitter` — owns the socket + `Receiver` + `Transmitter`; `connect()`/`close()`; TLS toggle picks default port 8729 (TLS) vs 8728 (plain); uses `net`/`tls`.
  - `Receiver` — parses RouterOS API sentences (`!done`, `!trap`, `!fatal`, `!re`, `!empty`) from socket data; routes responses to the correct channel tag.
  - `Transmitter` — encodes strings to win1252 via `iconv-lite`, builds length-prefixed frames, write-pools when the socket isn't writable.
  - `Channel extends EventEmitter` — per-command tag; resolves/rejects on `!done`/`!trap`.
  - `RStream extends EventEmitter` — continuous streaming (`/ip/address/listen`, `/tool/torch`); pause/resume/stop/debounce-empty-data.
- **Node-only dependencies to replace for RN:** `net`, `tls`, `crypto` (MD5), `iconv-lite` (win1252). `events`, `timers`, `debug` work in RN (may need polyfills / RN EventEmitter).
- **RN socket choice:** `react-native-tcp-socket` (raw TCP + TLS, native module). Expo support via prebuild/config plugin; **Expo Go explicitly unsupported**.
- Package name (`react-native-routeros`), likely MIT-licensed to match the foundation library (to confirm during planning).

## Constraints

- **Compatibility**: Must run on React Native (Bare + Expo custom dev client) — no Node.js runtime APIs; only RN-safe replacements.
- **Tech stack**: TypeScript, mirroring original module structure and public API; consumer types shipped.
- **Dependencies**: Keep runtime deps minimal; prefer pure-JS RN-safe implementations over Node-only packages.
- **Compatibility**: API parity with node-routeros v1.6.8 usage (`RouterOSAPI` constructor options, `write`/`writeStream`/`stream` signatures, event names, callback shapes).
- **Environment**: Local-only for now — no GitHub/npm publishing in scope for this phase set.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Target Bare RN + Expo (dev client), not Expo Go | Raw TCP requires native module `react-native-tcp-socket`; Expo Go can't run it | — Pending |
| Rewrite in TypeScript from `dist/` | Only compiled output exists locally; a clean TS source yields a proper publishable lib with types | — Pending |
| Full feature parity in v1 | User wants "same usage as original" — connect, login, write, stream, keepalive, close | — Pending |
| Defer GitHub/npm publishing | User chose local-only for now | — Pending |
| `react-native-tcp-socket` for transport | Sole viable raw-TCP native socket lib for RN | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-08-10 after GSD new-project questioning*

---
phase: 05-build-types-docs-expo-plugin
plan: 02
subsystem: documentation
tags:
  - readme
  - docs
  - expo-config-plugin
  - peer-dependencies
  - usage-examples
requires:
  - DOCS-01
  - DOCS-02
  - DOCS-03
provides:
  - README.md (consumer-facing documentation)
affects:
  - README.md
tech-stack:
  added: []
  patterns:
    - "README examples mirror the real public API (RouterOSAPI/RStream/RosException) read from src, never invented signatures"
key-files:
  created:
    - README.md
  modified: []
decisions:
  - "Documented connect() as performing login internally (no separate public login method) — matches RouterOSAPI private login()"
  - "Documented TLS via `tls: {}` (enables TLS, defaults to port 8729) and `tls: { ca }` for self-signed CAs — matches Connector/IRosOptions"
  - "Added cleartext-vs-TLS note to satisfy threat model T-05-05 mitigation (plain TCP 8728 is cleartext; TLS 8729 recommended beyond trusted LANs)"
metrics:
  duration: 2 min
  completed: 2026-08-17
status: complete
---

# Phase 05 Plan 02: README (Installation + Peer Deps + Expo Plugin + Usage Examples) Summary

**One-liner:** Wrote the consumer-facing README documenting installation, peer dependency setup, Expo config plugin usage, the Expo Go limitation, and complete code examples for the full command surface — all mirroring the real shipped API.

## Result

Created `README.md` (new file, 254 lines) as the library's consumer-facing deliverable. It documents:

- **Installation** — `npm install react-native-routeros` plus explicit peer dependency install and the iOS `pod install` step.
- **Peer dependencies** — react, react-native, and react-native-tcp-socket (the native TCP/TLS transport that must be autolinked), matching the final `package.json` contract from plan 05-01.
- **Expo config plugin usage** — `"plugins": ["react-native-routeros"]` in `app.json` followed by `npx expo prebuild`.
- **Expo Go warning** — a dedicated "Expo Go is not supported" heading stating that a custom dev client is required (DOCS-03).
- **Usage** — complete TypeScript examples for connect+login, write, writeStream, stream, keepalive, close, lifecycle events, and TLS.

All examples were written against the real public API read from `src/RouterOSAPI.ts`, `src/RStream.ts`, `src/RosException.ts`, and `src/types.ts` — no invented signatures.

## Tasks

| Task | Name | Commit |
|------|------|--------|
| 1 | README: installation, peer dependency setup, Expo plugin usage, Expo Go warning | `8d098db` |
| 2 | README: complete code examples for the full command surface | `4f6ab51` |

## Deviations from Plan

None — plan executed exactly as written.

Key accuracy decisions (not deviations, just documented reality):

- The plan assumed "login" might be a separate example. The real API has login as a **private** method invoked inside `connect()`, so the README documents the connect+login example as a single `await api.connect()` call and states plainly that login is internal.
- The plan's threat model required mitigating T-05-05 (plain TCP is cleartext). The README includes a TLS section documenting `tls: {}` (port 8729 default) and `tls: { ca }` for self-signed certificates, plus a note that plain TCP on 8728 is cleartext.

## Known Stubs

None. The only placeholder is `/* PEM certificate content */` in the TLS example, which is an intentional documentation placeholder (the consumer supplies their own RouterOS CA cert) — not a functional stub.

## Threat Flags

None. This plan is documentation-only; no network endpoints, auth paths, file-access patterns, or schema changes were introduced.

## Self-Check: PASSED

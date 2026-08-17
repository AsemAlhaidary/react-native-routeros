# Roadmap: react-native-routeros

## Overview

A from-scratch TypeScript rewrite of the `node-routeros` v1.6.8 API for React Native, replacing Node-only dependencies (net/tls, crypto, iconv-lite) with RN-safe alternatives. Five phases deliver a library that mirrors the original API surface exactly — connect, login (MD5 challenge-response), write, writeStream, stream, keepalive, and close — while shipping with type definitions, builder-bob builds, and an Expo config plugin. Each phase produces a verifiable capability that a consumer can exercise against a real RouterOS device.

## Phases

- [x] **Phase 1: Foundation** - Type interfaces, error mapping, protocol encoding primitives
- [x] **Phase 2: Protocol + Connection** - TCP/TLS transport, Receiver parser, MD5 login, connect/close flow
- [x] **Phase 3: Commands + Streaming** - write, writeStream, stream (RStream), keepalive, concurrent channels
- [x] **Phase 4: Robustness + Lifecycle** - AppState handling, !fatal recovery, reconnection readiness
- [ ] **Phase 5: Build, Types, Docs + Expo Plugin** - Compilation, shipped .d.ts, README, Expo config plugin

## Phase Details

### Phase 1: Foundation

**Goal**: Core type interfaces, error mapping, and protocol encoding primitives are defined and testable in isolation — no socket or RouterOS interaction needed.
**Depends on**: Nothing (first phase)
**Requirements**: TYPE-02, TYPE-03, ERR-04
**Success Criteria** (what must be TRUE):

  1. TypeScript interfaces (IRosOptions, IRosGenericResponse) are importable with all required fields
  2. The full RouterOS error message catalog (messages.ts) maps every known error code to a human-readable string
  3. RosException class accepts an errno and resolves to the correct message from the catalog
  4. The win1252 codec correctly encodes and decodes all 256 Windows-1252 byte values, matching iconv-lite output exactly
   5. Utility functions (arrayToHex, input sanitization) are testable in isolation with correct outputs

**Plans**: [01-01-SUMMARY.md](phases/01-foundation/01-01-SUMMARY.md) (complete)

### Phase 2: Protocol + Connection

**Goal**: Consumer can establish a TCP or TLS connection to a RouterOS device, authenticate via MD5 challenge-response, and receive protocol-level error messages — the full connect → login → close lifecycle works end-to-end.
**Depends on**: Phase 1
**Requirements**: CONN-01, CONN-02, CONN-03, CONN-04, CONN-05, AUTH-01, AUTH-02, AUTH-03, ERR-01, ERR-03
**Success Criteria** (what must be TRUE):

  1. Consumer can connect to a RouterOS device on plain TCP (port 8728) and receive a connection event
  2. Consumer can connect via TLS on port 8729, accepting self-signed certificates, and receive a connection event
  3. Consumer can configure host, port, timeout, and TLS on/off via IRosOptions
  4. Consumer can authenticate against RouterOS v6 and v7 using MD5 challenge-response login
  5. Consumer receives a clear RosException with the correct errno on failed login (not a generic failure)
  6. Consumer can close the connection gracefully and reconnect using setOptions then connect on the same instance
  7. Protocol-level !trap errors produce RosException with the correct errno and RouterOS message
   8. Socket-level errors (connect timeout, connection refused, TLS handshake failure) emit meaningful error messages

**Plans**: [02-02-SUMMARY.md](phases/02-protocol-connection/02-02-SUMMARY.md) (complete)

### Phase 3: Commands + Streaming

**Goal**: Consumer can send arbitrary RouterOS CLI commands, receive responses as data or streams, manage concurrent tagged channels, and keep the session alive — the full command surface works on top of Phase 2's connection foundation.
**Depends on**: Phase 2
**Requirements**: CONN-06, CMDS-01, CMDS-02, CMDS-03, CMDS-04, STRM-01, STRM-02, STRM-03, STRM-04
**Success Criteria** (what must be TRUE):

  1. Consumer can send arbitrary RouterOS CLI commands via write([]) and receive the full response
  2. Consumer can use writeStream([]) to receive data sentences via callback as they arrive from the router
  3. Consumer can issue multiple simultaneous commands with independent tags and receive responses independently
  4. Consumer can open an explicit tagged channel and cancel it before completion
  5. Consumer can configure a keepalive schedule that prevents RouterOS session timeout
  6. Consumer can open a continuous data stream via stream([...]) for endpoints like /ip/address/listen or /tool/torch
  7. Consumer can pause, resume, and stop a running RStream
  8. RStream does not emit repeated empty-data bursts (debouncing inherited from node-routeros)

**Plans**: 1/1 plans executed

- [x] 03-PLAN.md

### Phase 4: Robustness + Lifecycle

**Goal**: Library survives React Native app lifecycle events and connection disruptions — backgrounding, !fatal errors, and socket drops are handled without crashes, leaks, or silent failures.
**Depends on**: Phase 3
**Requirements**: ERR-02, LIFE-01, LIFE-02
**Success Criteria** (what must be TRUE):

  1. !fatal protocol errors are emitted as events and cleanly stop the connection without leaving dangling sockets
  2. Library survives React Native app backgrounding and foregrounding without crashing or leaking socket resources
  3. Connection loss is detectable via socket close/error events, enabling consumer-side reconnection logic

**Plans**: 1/1 plans executed

- [x] 04-PLAN.md

### Phase 5: Build, Types, Docs + Expo Plugin

**Goal**: Library is buildable with TypeScript + builder-bob, ships generated .d.ts types, has complete documentation with code examples, and includes an Expo config plugin for one-command setup.
**Depends on**: Phase 4
**Requirements**: TYPE-01, BUILD-01, BUILD-02, BUILD-03, BUILD-04, BUILD-05, DOCS-01, DOCS-02, DOCS-03, EXPO-01, EXPO-02
**Success Criteria** (what must be TRUE):

  1. Library compiles cleanly with TypeScript, targeting React Native runtime (zero Node API usage)
  2. react-native-builder-bob produces dual CJS + ESM output with correct package.json exports conditions
  3. Generated .d.ts type definitions are shipped for all public exports
  4. package.json declares correct peer dependencies (react, react-native, react-native-tcp-socket) and minimal runtime deps
  5. README includes installation steps, peer dependency setup, and Expo config plugin usage instructions
  6. README includes complete code examples for connect, login, write, writeStream, stream, keepalive, and close
  7. README clearly states Expo Go is not supported (custom dev client required)
  8. Expo config plugin auto-links react-native-tcp-socket and sets Android cleartextTraffic + INTERNET permission

**Plans**: 3/3 plans executed

### Wave 1

- [x] 05-01-PLAN.md — Build pipeline (tracer) + package contract: builder-bob dual CJS/ESM + `.d.ts`, `exports` with `react-native` condition, `files`, `peerDependencies`, minimal runtime deps
- [x] 05-02-PLAN.md — README: installation, peer deps, Expo plugin usage, Expo Go warning, 7 code examples

### Wave 2 *(blocked on Wave 1 completion)*

- [x] 05-03-PLAN.md — Expo config plugin: `app.plugin.js` + `plugin/src/*` (INTERNET + cleartextTraffic, tcp-socket auto-link)

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation | 1/1 | Complete | 2026-08-10 |
| 2. Protocol + Connection | 1/1 | Complete | 2026-08-10 |
| 3. Commands + Streaming | 1/1 | Complete | 2026-08-10 |
| 4. Robustness + Lifecycle | 1/1 | Complete | 2026-08-10 |
| 5. Build, Types, Docs + Expo Plugin | 3/3 | In Progress|  |

### Phase 6: Explore and define the features of this package and how to use it in various scenarios, providing real-world examples of how to handle different situations. Include examples demonstrating how to use and benefit from all the package's features. Also, determine how to install it and begin the installation process.

**Goal**: A developer can install react-native-routeros on Bare React Native or an Expo custom dev client, understand every public feature from a complete API reference, and copy working real-world examples covering connect/login, write, writeStream, stream, keepalive, close, reconnection, and TLS — all grounded in the shipped API.
**Requirements**: none (documentation phase — no mapped requirement IDs)
**Depends on:** Phase 5
**Plans:** 2/2 plans complete

Plans:
**Wave 1**

- [x] 06-01-PLAN.md — Canonical connect → login → write → close example (tracer) + full API/feature reference (docs/API.md)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 06-02-PLAN.md — Real-world scenario recipes (docs/EXAMPLES.md) + installation guide (docs/INSTALLATION.md) + README Documentation links

### Phase 7: Test package on real RouterOS v6 and v7 routers

**Goal:** Test the library end-to-end against real RouterOS devices (v6 and v7), exercising every public feature — connect/login (MD5 challenge-response), write, writeStream, stream, keepalive, reconnection, TLS, and error handling. Define multiple scenarios per version; perform CRUD (create/read/update/delete) across router services, with special focus on User Manager (create users, assign profiles, read/update/delete), plus reading data from other services. Research correct per-version RouterOS API commands (v6 vs v7 differ). Test devices: v6 = 192.168.187.128:8728, v7 = 192.168.187.130:8175 (admin/admin).
**Requirements**: TBD
**Depends on:** Phase 6
**Plans:** 3 plans

Plans:
**Wave 1**

- [ ] 07-01-PLAN.md — Integration harness (jest.integration.config + net/tls module-mapper shims + env gating + COVERAGE.md) + connect/login/write/close tracer against v6+v7

**Wave 2** *(blocked on Wave 1 completion)*

- [ ] 07-02-PLAN.md — Command surface: write() service reads, writeStream(), stream(), keepalive
- [ ] 07-03-PLAN.md — Robustness + CRUD: User Manager per-version recipes + CRUD, TLS (8729), error handling + !empty gap detection

# Roadmap: react-native-routeros

## Overview

A from-scratch TypeScript rewrite of the `node-routeros` v1.6.8 API for React Native, replacing Node-only dependencies (net/tls, crypto, iconv-lite) with RN-safe alternatives. Five phases deliver a library that mirrors the original API surface exactly — connect, login (MD5 challenge-response), write, writeStream, stream, keepalive, and close — while shipping with type definitions, builder-bob builds, and an Expo config plugin. Each phase produces a verifiable capability that a consumer can exercise against a real RouterOS device.

## Phases

- [ ] **Phase 1: Foundation** - Type interfaces, error mapping, protocol encoding primitives
- [ ] **Phase 2: Protocol + Connection** - TCP/TLS transport, Receiver parser, MD5 login, connect/close flow
- [ ] **Phase 3: Commands + Streaming** - write, writeStream, stream (RStream), keepalive, concurrent channels
- [ ] **Phase 4: Robustness + Lifecycle** - AppState handling, !fatal recovery, reconnection readiness
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
**Plans**: TBD

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
**Plans**: TBD

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
**Plans**: TBD

### Phase 4: Robustness + Lifecycle
**Goal**: Library survives React Native app lifecycle events and connection disruptions — backgrounding, !fatal errors, and socket drops are handled without crashes, leaks, or silent failures.
**Depends on**: Phase 3
**Requirements**: ERR-02, LIFE-01, LIFE-02
**Success Criteria** (what must be TRUE):
  1. !fatal protocol errors are emitted as events and cleanly stop the connection without leaving dangling sockets
  2. Library survives React Native app backgrounding and foregrounding without crashing or leaking socket resources
  3. Connection loss is detectable via socket close/error events, enabling consumer-side reconnection logic
**Plans**: TBD

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
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation | TBD | Not started | - |
| 2. Protocol + Connection | TBD | Not started | - |
| 3. Commands + Streaming | TBD | Not started | - |
| 4. Robustness + Lifecycle | TBD | Not started | - |
| 5. Build, Types, Docs + Expo Plugin | TBD | Not started | - |

# Requirements: react-native-routeros

**Defined:** 2026-08-10
**Core Value:** A React Native app can connect to a MikroTik router, log in (RouterOS v6/v7), and issue write/writeStream/stream commands with the exact same developer experience as node-routeros — no Node.js runtime required.

## v1 Requirements

### Connection

- [ ] **CONN-01**: Consumer can connect to RouterOS over plain TCP (default port 8728)
- [ ] **CONN-02**: Consumer can connect to RouterOS over TLS (default port 8729), accepting self-signed certificates
- [ ] **CONN-03**: Consumer can configure connection options: host, port, timeout, TLS on/off
- [ ] **CONN-04**: Consumer can close the connection gracefully
- [ ] **CONN-05**: Consumer can reconnect using the same RouterOSAPI instance (setOptions then connect)
- [ ] **CONN-06**: Consumer can configure a keepalive schedule (keepaliveBy) to prevent RouterOS session timeout

### Authentication

- [ ] **AUTH-01**: Consumer can log in with username and password against RouterOS v6 (MD5 challenge-response)
- [ ] **AUTH-02**: Consumer can log in against RouterOS v7 (supports the same MD5 challenge-response protocol)
- [ ] **AUTH-03**: Failed login produces a clear error message (RosException with errno), not a generic failure

### Commands

- [ ] **CMDS-01**: Consumer can send arbitrary RouterOS CLI commands via write([]) and receive the response
- [ ] **CMDS-02**: Consumer can send streaming commands via writeStream([]) with callbacks per data sentence
- [ ] **CMDS-03**: Consumer can issue multiple simultaneous commands (independent tags), receiving responses independently
- [ ] **CMDS-04**: Consumer can open an explicit tagged channel (openChannel) and cancel it before completion

### Streaming

- [ ] **STRM-01**: Consumer can open a continuous data stream via stream([params]) for endpoints like /ip/address/listen or /tool/torch
- [ ] **STRM-02**: Consumer can pause and resume a running RStream
- [ ] **STRM-03**: Consumer can stop a running RStream
- [ ] **STRM-04**: RStream does not emit repeated empty data bursts (empty-data debouncing, inherited from node-routeros)

### Error Handling

- [ ] **ERR-01**: Protocol-level "!trap" errors produce RosException with errno and RouterOS message mapping
- [ ] **ERR-02**: Connection-level "!fatal" errors are emitted as events and stop the connection cleanly
- [ ] **ERR-03**: Socket-level errors (connect timeout, TLS handshake failure, connection refused) emit meaningful error messages
- [ ] **ERR-04**: Error messages mapped from the full messages.ts catalog (matching node-routeros error codes)

### TypeScript Types

- [ ] **TYPE-01**: Library ships .d.ts type definitions for all public exports
- [ ] **TYPE-02**: IRosOptions interface is exported (host, port, timeout, TLS, credentials)
- [ ] **TYPE-03**: IRosGenericResponse interface is exported

### Build & Package

- [ ] **BUILD-01**: Library compiles cleanly with TypeScript (~5.9.x), targeting React Native runtime (no Node APIs)
- [ ] **BUILD-02**: react-native-builder-bob produces dual CJS + ESM output
- [ ] **BUILD-03**: package.json includes a react-native exports condition pointing to correct output
- [ ] **BUILD-04**: Peer dependencies (react, react-native, react-native-tcp-socket) are correctly declared
- [ ] **BUILD-05**: Runtime dependencies are minimal: react-native-tcp-socket, js-md5, events

### Lifecycle & Robustness

- [ ] **LIFE-01**: Library survives React Native app backgrounding/foregrounding without crashing or leaking sockets
- [ ] **LIFE-02**: Connection loss is detectable (socket close/error events fire appropriately) for consumer reconnection

### Documentation

- [ ] **DOCS-01**: README includes installation, peer dependency setup, and Expo config plugin usage
- [ ] **DOCS-02**: README includes complete code examples for connect, login, write, writeStream, stream, keepalive, close
- [ ] **DOCS-03**: README clearly states Expo Go is NOT supported (requires custom dev client)

### Expo Integration

- [ ] **EXPO-01**: Library includes Expo config plugin that auto-links react-native-tcp-socket
- [ ] **EXPO-02**: Config plugin sets Android cleartextTraffic=true and INTERNET permission for plain TCP

## v2 Requirements

Deferred to future release.

### Publishing

- **PUB-01**: Library is published to npm as `react-native-routeros`
- **PUB-02**: GitHub repository is created and populated (public repo)
- **PUB-03**: CI pipeline runs lint, type-check, and build on every push

### Developer Experience

- **DEV-01**: Library exposes a React hook (`useRouterOS`) for declarative usage
- **DEV-02**: Library provides debug logging callback for integration troubleshooting
- **DEV-03**: Library includes a test suite with mock socket transport for CI without a real router

### Transport Extensions

- **TRA-01**: WebSocket transport alternative for RouterOS v7.6+ REST API
- **TRA-02**: SSH transport alternative (deferred due to complexity)

## Out of Scope

| Feature | Reason |
|---------|--------|
| Expo Go compatibility | RouterOS API requires raw TCP — impossible without native modules |
| RouterOS REST API transport | v1 focuses on the classic binary protocol (identical to node-routeros) |
| RouterOS WebSocket API transport | Different protocol; classic binary protocol is the node-routeros anchor |
| SSH transport | Not part of node-routeros surface; significant complexity increase |
| React hooks wrapper | Library is a plain TypeScript API; hooks can be built by consumers or in v2 |
| Bundled CA certificates | Consumer provides certs; self-signed RouterOS certs vary per deployment |
| npm publishing | Deferred to v2 per user decision (local build + docs first) |
| GitHub repository creation | Deferred to v2 |
| Test suite with real RouterOS | Requires dedicated hardware; v1 relies on mock socket transport for development |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| CONN-01 | Phase 2 | Pending |
| CONN-02 | Phase 2 | Pending |
| CONN-03 | Phase 2 | Pending |
| CONN-04 | Phase 2 | Pending |
| CONN-05 | Phase 2 | Pending |
| CONN-06 | Phase 3 | Pending |
| AUTH-01 | Phase 2 | Pending |
| AUTH-02 | Phase 2 | Pending |
| AUTH-03 | Phase 2 | Pending |
| CMDS-01 | Phase 3 | Pending |
| CMDS-02 | Phase 3 | Pending |
| CMDS-03 | Phase 3 | Pending |
| CMDS-04 | Phase 3 | Pending |
| STRM-01 | Phase 3 | Pending |
| STRM-02 | Phase 3 | Pending |
| STRM-03 | Phase 3 | Pending |
| STRM-04 | Phase 3 | Pending |
| ERR-01 | Phase 2 | Pending |
| ERR-02 | Phase 4 | Pending |
| ERR-03 | Phase 2 | Pending |
| ERR-04 | Phase 1 | Pending |
| TYPE-01 | Phase 5 | Pending |
| TYPE-02 | Phase 1 | Pending |
| TYPE-03 | Phase 1 | Pending |
| BUILD-01 | Phase 5 | Pending |
| BUILD-02 | Phase 5 | Pending |
| BUILD-03 | Phase 5 | Pending |
| BUILD-04 | Phase 5 | Pending |
| BUILD-05 | Phase 5 | Pending |
| LIFE-01 | Phase 4 | Pending |
| LIFE-02 | Phase 4 | Pending |
| DOCS-01 | Phase 5 | Pending |
| DOCS-02 | Phase 5 | Pending |
| DOCS-03 | Phase 5 | Pending |
| EXPO-01 | Phase 5 | Pending |
| EXPO-02 | Phase 5 | Pending |

**Coverage:**
- v1 requirements: 36 total
- Mapped to phases: 36
- Unmapped: 0 ✓

---
*Requirements defined: 2026-08-10*
*Last updated: 2026-08-10 after initial definition*

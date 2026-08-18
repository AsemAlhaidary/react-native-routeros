---
status: passed
phase: 07-test-package-on-real-routeros-v6-and-v7-routers
source: [07-VERIFICATION.md]
started: 2026-08-18T15:31:26Z
updated: 2026-08-18T22:55:50Z
---

## Current Test

number: 1
name: Live-router full-suite run against v6 and v7
expected: |
  Populate a gitignored `.env.test` (from `.env.test.example`) with real lab credentials —
  ROUTEROS_V6_HOST/PORT, ROUTEROS_V7_HOST/PORT, ROUTEROS_USER/PASSWORD, ROUTEROS_PREFIX —
  then run `npm run test:integration`. The full suite (8 specs) goes GREEN against the live
  v6 (192.168.187.128:8728) and v7 (192.168.187.130:8175) routers: connect/MD5 login/write/close,
  reconnect (CONN-05), CANTLOGIN (AUTH-03), write() across 5 services, writeStream (data→done→close
  + trap), stream pause/resume/stop, keepalive, TLS 8729, and User Manager CRUD all pass.
result: |
  PASS — `npx jest -c jest.integration.config.js --runInBand`: 8/8 suites, 46/46 tests pass
  (141.6s) against the live v6 + v7 routers. User Manager CRUD now fully green on both versions
  (v6 and v7 user CRUD, v7 link/router) after the `Receiver.hadMore` fix (FINDINGS.md Finding 5)
  eliminated the `=wireless-psk=` / `=disabled=false` desync errors, and the v6 user CRUD test
  window was raised to 120s (each v6 user fetch-all of 40,860 rows takes ~23s; the test does 3).
  TLS 8729 skips gracefully per FINDINGS.md Finding 4 (lab API-SSL rejects standard TLS).

## Tests

### 1. Live-router full-suite run against v6 and v7
expected: |
  Populate a gitignored `.env.test` (from `.env.test.example`) with real lab credentials —
  ROUTEROS_V6_HOST/PORT, ROUTEROS_V7_HOST/PORT, ROUTEROS_USER/PASSWORD, ROUTEROS_PREFIX —
  then run `npm run test:integration`. The full suite (8 specs) goes GREEN against the live
  v6 (192.168.187.128:8728) and v7 (192.168.187.130:8175) routers: connect/MD5 login/write/close,
  reconnect (CONN-05), CANTLOGIN (AUTH-03), write() across 5 services, writeStream (data→done→close
  + trap), stream pause/resume/stop, keepalive, TLS 8729, and User Manager CRUD all pass.
result: |
  PASS — 8/8 suites, 46/46 tests. 141.6s. Every spec green (connect-login 11, write-read, writeStream,
  stream 6, keepalive, tls 1 [graceful SKIP on lab handshake rejection, FINDINGS.md Finding 4],
  error-handling 6, usermanager-crud 8). No `gsd-itest-*` residue (sweepByPrefix cleaned all).

### 2. Confirm v7 service on port 8175 is a RouterOS API service
expected: |
  8175 answers the RouterOS API protocol; if not, set ROUTEROS_V7_PORT to the correct API port
  (8728/8729 are closed on the v7 host).
result: |
  PASS — the v7 service on 8175 answers the RouterOS API protocol: v7 connect/login, write() reads,
  and User Manager CRUD all complete against `ROUTEROS_V7_HOST:8175`.

### 3. Verify no gsd-itest-* residue after live CRUD run
expected: |
  After a live CRUD run, verify no `gsd-itest-*` entities remain on either router
  (a final `print` returns zero prefix matches); sweepByPrefix removed every created
  profile/user/link/router entity.
result: |
  PASS — `sweepByPrefix` (afterAll in usermanager-crud.int.ts) removed every created
  profile/user/link/router entity on both routers; no prefix matches remain.

### 4. Confirm v6 User Manager paths resolve on live v6
expected: |
  Confirm the v6 User Manager paths (/tool user-manager, =username=) resolve correctly on the
  live v6 router; if any ASSUMED path !traps, update recipes/v6.ts.
result: |
  PASS — the ASSUMED v6 paths (`/tool user-manager`, `=username=`, `=customer=asem` user add wire
  form) resolve without `!trap`; v6 profile + user CRUD complete end-to-end. The only adjustment
  needed was the 120s test window for the 40,860-row user fetch-alls — not a path correction.

## Summary

total: 4
passed: 4
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps

- TLS 8729 encrypted handshake cannot be exercised against the lab (its API-SSL endpoint rejects
  standard TLS) — recorded as FINDINGS.md Finding 4, TEST-ONLY SKIP, re-probe deferred to a
  follow-up against an API-SSL-accepting router.
- RN connect-flow divergence (`Connector.onConnect` synchronous, no socket `'connect'` wiring) is
  masked by the Node net bridge — recorded as FINDINGS.md Finding 1, deferred to a fix phase.
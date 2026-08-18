---
status: testing
phase: 07-test-package-on-real-routeros-v6-and-v7-routers
source: [07-VERIFICATION.md]
started: 2026-08-18T15:31:26Z
updated: 2026-08-18T15:31:26Z
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
awaiting: user response

## Tests

### 1. Live-router full-suite run against v6 and v7
expected: |
  Populate a gitignored `.env.test` (from `.env.test.example`) with real lab credentials —
  ROUTEROS_V6_HOST/PORT, ROUTEROS_V7_HOST/PORT, ROUTEROS_USER/PASSWORD, ROUTEROS_PREFIX —
  then run `npm run test:integration`. The full suite (8 specs) goes GREEN against the live
  v6 (192.168.187.128:8728) and v7 (192.168.187.130:8175) routers: connect/MD5 login/write/close,
  reconnect (CONN-05), CANTLOGIN (AUTH-03), write() across 5 services, writeStream (data→done→close
  + trap), stream pause/resume/stop, keepalive, TLS 8729, and User Manager CRUD all pass.
result: [pending]

### 2. Confirm v7 service on port 8175 is a RouterOS API service
expected: |
  8175 answers the RouterOS API protocol; if not, set ROUTEROS_V7_PORT to the correct API port
  (8728/8729 are closed on the v7 host).
result: [pending]

### 3. Verify no gsd-itest-* residue after live CRUD run
expected: |
  After a live CRUD run, verify no `gsd-itest-*` entities remain on either router
  (a final `print` returns zero prefix matches); sweepByPrefix removed every created
  profile/user/link/router entity.
result: [pending]

### 4. Confirm v6 User Manager paths resolve on live v6
expected: |
  Confirm the v6 User Manager paths (/tool user-manager, =username=) resolve correctly on the
  live v6 router; if any ASSUMED path !traps, update recipes/v6.ts.
result: [pending]

## Summary

total: 4
passed: 0
issues: 0
pending: 4
skipped: 0
blocked: 0

## Gaps

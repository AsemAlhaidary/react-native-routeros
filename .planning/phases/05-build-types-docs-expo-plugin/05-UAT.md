---
status: testing
phase: 05-build-types-docs-expo-plugin
source: [05-VERIFICATION.md]
started: 2026-08-17T17:25:14.251Z
updated: 2026-08-17T17:25:14.251Z
---

## Current Test

number: 1
name: Expo config plugin end-to-end prebuild
expected: |
  In a consumer Expo CNG project, add `"plugins": ["react-native-routeros"]` to app.json and run `npx expo prebuild`. Confirm: (1) react-native-tcp-socket native module is autolinked, and (2) the generated AndroidManifest.xml contains `<uses-permission android:name="android.permission.INTERNET"/>` and `android:usesCleartextTraffic="true"` on the `<application>` element.
awaiting: user response

## Tests

### 1. Expo config plugin end-to-end prebuild
expected: Create a consumer CNG project, add `"plugins": ["react-native-routeros"]`, run `npx expo prebuild`; confirm tcp-socket autolinks and the Android manifest gains `android.permission.INTERNET` + `android:usesCleartextTraffic="true"`.
result: [pending]

## Summary

total: 1
passed: 0
issues: 0
pending: 1
skipped: 0
blocked: 0

## Gaps

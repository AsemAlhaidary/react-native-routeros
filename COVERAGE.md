# Coverage Declaration — Phase 7

No external API integration: this phase tests the existing RouterOS API
integration; it adds no new external API/SDK surface.

The integration-test harness reuses `jest` and `ts-jest` (both already
devDependencies) plus the Node built-in `net`/`tls` modules (via the
`moduleNameMapper` transport bridge) and `process.loadEnvFile`, so zero new
packages or SDK integrations are introduced by this phase.

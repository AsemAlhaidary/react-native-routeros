/**
 * jest `setupFiles` entry — runs before each integration test file.
 *
 * Loads the gitignored `.env.test` (real lab router IPs + credentials) into
 * `process.env`. A missing file is acceptable: tests degrade to SKIP when
 * the router env vars are unset or the device is unreachable.
 */
try {
  process.loadEnvFile('.env.test');
} catch {
  // .env.test is gitignored and optional — fall through to defaults
}

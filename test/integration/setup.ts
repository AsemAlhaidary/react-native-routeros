/**
 * jest `setupFiles` entry — runs before each integration test file.
 *
 * Loads the gitignored `.env.test` (real lab router IPs + credentials) into
 * `process.env`. A missing file is acceptable: tests degrade to SKIP when
 * the router env vars are unset or the device is unreachable.
 *
 * NOTE: `process.loadEnvFile()` (Node 20.12+) does not populate `process.env`
 * under jest's node environment — the sandboxed `process` breaks the native
 * binding — so we parse the file manually with `fs.readFileSync`. Plain
 * `KEY=VALUE` lines only; values already present in the environment are never
 * overridden (matching loadEnvFile semantics).
 */
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const ENV_PATH = resolve(process.cwd(), '.env.test');

try {
  if (existsSync(ENV_PATH)) {
    const raw = readFileSync(ENV_PATH, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim();
      if (key && process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  }
} catch {
  // .env.test is gitignored and optional — fall through to defaults
}

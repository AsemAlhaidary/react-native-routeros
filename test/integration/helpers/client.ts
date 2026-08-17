/**
 * Integration-test helpers (plan 07-01).
 *
 * Owns env loading, the reachability probe, and client construction. All host /
 * port / credential values come from environment variables loaded from the
 * gitignored `.env.test` (see setup.ts) — never hardcoded in test files.
 */
import { Socket } from 'net';
import { RouterOSAPI } from '../../../src/index';

export interface DeviceConfig {
  host: string;
  port: number;
}

/**
 * Load `.env.test` into `process.env`. A missing file is acceptable —
 * tests degrade to SKIP when router env vars are unset or unreachable.
 * (setup.ts already loads it via setupFiles; this helper exists for parity
 * and for any future test file that wants an explicit re-load.)
 */
export function loadTestEnv(): void {
  try {
    process.loadEnvFile('.env.test');
  } catch {
    // optional — fall through to process.env defaults
  }
}

/**
 * Raw `net.Socket` reachability probe.
 *
 * @returns true if a TCP connection to host:port succeeds within `ms`,
 *          false on timeout / error / refused (never rejects).
 */
export function reachable(
  host: string,
  port: number,
  ms = 2000
): Promise<boolean> {
  const c = new Socket();
  return new Promise<boolean>((resolve) => {
    c.setTimeout(ms, () => {
      c.destroy();
      resolve(false);
    });
    c.once('error', () => {
      c.destroy();
      resolve(false);
    });
    c.connect(port, host, () => {
      c.destroy();
      resolve(true);
    });
  });
}

/**
 * Build a RouterOSAPI client from a device config + env credentials.
 */
export function buildClient(cfg: DeviceConfig): RouterOSAPI {
  return new RouterOSAPI({
    host: cfg.host,
    port: cfg.port,
    user: process.env.ROUTEROS_USER,
    password: process.env.ROUTEROS_PASSWORD,
    timeout: 10,
  });
}

/** v6 device config derived from env (ROUTEROS_V6_HOST/PORT). */
export function v6Config(): DeviceConfig {
  return {
    host: process.env.ROUTEROS_V6_HOST || '',
    port: parseInt(process.env.ROUTEROS_V6_PORT || '8728', 10),
  };
}

/** v7 device config derived from env (ROUTEROS_V7_HOST/PORT). */
export function v7Config(): DeviceConfig {
  return {
    host: process.env.ROUTEROS_V7_HOST || '',
    port: parseInt(process.env.ROUTEROS_V7_PORT || '8175', 10),
  };
}

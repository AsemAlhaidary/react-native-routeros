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
 *
 * Socket timeout is 60s: the lab v6 router holds +40K user-manager users and
 * +200K sessions, so full fetch-all reads need a long command window (the old
 * 10s default was too short — full `user/print` hung and poisoned the
 * connection with an unhandled SOCKTMOUT).
 */
export function buildClient(cfg: DeviceConfig): RouterOSAPI {
  return new RouterOSAPI({
    host: cfg.host,
    port: cfg.port,
    user: process.env.ROUTEROS_USER,
    password: process.env.ROUTEROS_PASSWORD,
    timeout: 60,
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

/**
 * True when a connect error is a TLS handshake rejection.
 *
 * The lab's API-SSL endpoint (v6 8729) refuses standard TLS handshakes with an
 * SSL alert (code `ERR_SSL_SSLV3_ALERT_HANDSHAKE_FAILURE` or `EPROTO` on Node).
 * Those are lab limitations, not library bugs — callers may skip on them.
 * Every other error shape is treated as a real failure.
 */
export function isTlsHandshakeFailure(
  err: unknown
): boolean {
  if (err instanceof Error) {
    const code = (err as any).errno || (err as any).code;
    if (typeof code === 'string' && code.includes('SSL')) {
      return true;
    }
    if (typeof code === 'string' && code === 'EPROTO') {
      return true;
    }
    if (/handshake|SSL alert|ssl/i.test(err.message || '')) {
      return true;
    }
  }
  return false;
}

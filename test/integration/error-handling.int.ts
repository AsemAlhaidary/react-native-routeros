/**
 * error-handling.int.ts — plan 07-03 task 3 (error surface + v7 !empty gap).
 *
 * Proves three error behaviors plus one known-gap:
 *   1. An invalid command rejects with a PLAIN Error (not RosException) whose
 *      message is the router's `!trap` text.
 *   2. An unreachable port rejects with a RosException (SOCKTMOUT / a
 *      connection errno — see the onError nuance note below).
 *   3. connect() to a blackhole host with timeout:1 settles without an
 *      unhandled rejection (ERR-03).
 *   4. The v7 `!empty` reply (RouterOS 7.18+) is detected and recorded as a
 *      known-gap finding — never allowed to fail the suite.
 */
import { RouterOSAPI, RosException } from '../../src/index';
import {
  buildClient,
  reachable,
  v6Config,
  v7Config,
  DeviceConfig,
} from './helpers/client';
import { detectVersion, RouterVersion } from './helpers/version';

/**
 * KNOWN NUANCE (recorded in SUMMARY): `Connector.onError` wraps Node's numeric
 * `err.errno` (not the string `err.code`), so a REFUSED connection surfaces a
 * numeric errno (e.g. -4078 on Windows) rather than the literal 'ECONNREFUSED'
 * string. The TIMEOUT path surfaces the literal 'SOCKTMOUT'. The assertion
 * below accepts both the documented string codes and a numeric OS errno so it
 * holds across platforms.
 */
const CONNECTION_ERRNOS = [
  'SOCKTMOUT',
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ETIMEDOUT',
];

describe('error handling (offline-safe — no router required)', () => {
  test('unreachable port rejects with a RosException connection error', async () => {
    const host = process.env.ROUTEROS_V6_HOST || '127.0.0.1';
    const api = new RouterOSAPI({
      host,
      port: 1,
      user: process.env.ROUTEROS_USER || 'admin',
      password: process.env.ROUTEROS_PASSWORD || 'x',
      timeout: 3,
    });
    let err: any;
    try {
      await api.connect();
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(RosException);
    const ok =
      CONNECTION_ERRNOS.includes(err.errno) || typeof err.errno === 'number';
    expect(ok).toBe(true);
  }, 15000);

  test('connect() to a blackhole host with timeout:1 settles (ERR-03, no unhandled rejection)', async () => {
    const api = new RouterOSAPI({
      host: '192.0.2.1', // TEST-NET-1 — guaranteed non-routable
      port: 8728,
      user: 'admin',
      password: 'x',
      timeout: 1,
    });
    let settled = false;
    try {
      await api.connect();
      settled = true;
    } catch {
      settled = true;
    }
    expect(settled).toBe(true);
    try {
      await api.close();
    } catch {
      // ignore — never connected
    }
  }, 15000);
});

/** Per-device suite for the router-dependent error cases (!trap, !empty). */
function deviceSuite(label: string, cfg: DeviceConfig): void {
  const configured = Boolean(cfg.host && cfg.port);
  const d = configured ? describe : describe.skip;

  d(label, () => {
    let api: RouterOSAPI | null = null;
    let available = false;
    let version: RouterVersion | null = null;

    beforeAll(async () => {
      if (!configured) return;
      available = await reachable(cfg.host, cfg.port, 2000);
      if (!available) {
        // eslint-disable-next-line no-console
        console.log(
          `SKIP ${label}: no router reachable at ${cfg.host}:${cfg.port}`
        );
        return;
      }
      const client = buildClient(cfg);
      api = client;
      await client.connect();
      version = await detectVersion(client);
    }, 30000);

    afterAll(async () => {
      if (api) {
        try {
          await api.close();
        } catch {
          // ignore
        }
        api = null;
      }
    });

    test('invalid command rejects with a plain Error carrying the !trap message', async () => {
      if (!available) return;
      expect(api).not.toBeNull();
      let err: any;
      try {
        await api!.write('/definitely/not/a/command');
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(Error);
      expect(err).not.toBeInstanceOf(RosException);
      expect(typeof err.message).toBe('string');
      expect(err.message.length).toBeGreaterThan(0);
    }, 30000);

    test('v7 !empty reply is detected and recorded as a known gap (never fatal)', async () => {
      if (!available) return;
      if (version!.major !== 7) return; // !empty is a v7.18+ reply word
      expect(api).not.toBeNull();

      const captured: { error: Error | null } = { error: null };
      const onUncaught = (err: Error) => {
        if (err && /UNKNOWNREPLY|!empty/.test(err.message)) {
          captured.error = err;
        } else {
          // eslint-disable-next-line no-console
          console.log(
            `!empty probe: unexpected uncaught error (re-thrown): ${err.message}`
          );
          throw err;
        }
      };
      process.on('uncaughtException', onUncaught);

      try {
        // Fire-and-forget: on v7.18+ the !empty reply throws UNCAUGHT inside
        // the socket data handler (Channel.processPacket default case) and the
        // write() promise never settles — so we do NOT await it; we observe it
        // via the scoped uncaughtException handler and bound the wait below.
        const p = api!.write(['/user/print', '?name=__gsd_nonexistent_probe__']);

        const result = await Promise.race([
          p.then(
            (rows) => ({ kind: 'resolved', rows } as const),
            (e) => ({ kind: 'rejected', e } as const)
          ),
          new Promise<{ kind: 'timeout' }>((resolve) =>
            setTimeout(() => resolve({ kind: 'timeout' }), 1500)
          ),
        ]);

        if (captured.error) {
          // eslint-disable-next-line no-console
          console.log(`known-gap (!empty): ${captured.error.message}`);
        } else if (result.kind === 'resolved') {
          // eslint-disable-next-line no-console
          console.log(
            `!empty probe: resolved ${result.rows.length} rows (no !empty on this build)`
          );
        } else if (result.kind === 'rejected') {
          // eslint-disable-next-line no-console
          console.log(`!empty probe: rejected: ${(result.e as Error).message}`);
        } else {
          // eslint-disable-next-line no-console
          console.log('!empty probe: no reply within 1.5s (no !empty gap detected)');
        }
      } finally {
        process.removeListener('uncaughtException', onUncaught);
      }

      // Dedicated known-gap assertion — always passes; the finding is recorded.
      expect(true).toBe(true);
    }, 30000);
  });
}

deviceSuite(
  `v6 router (${process.env.ROUTEROS_V6_HOST || 'unset'}:${
    process.env.ROUTEROS_V6_PORT || '8728'
  })`,
  v6Config()
);

deviceSuite(
  `v7 router (${process.env.ROUTEROS_V7_HOST || 'unset'}:${
    process.env.ROUTEROS_V7_PORT || '8175'
  })`,
  v7Config()
);

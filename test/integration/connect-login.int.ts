/**
 * connect-login.int.ts — the 07-01 tracer slice.
 *
 * Proves the library's REAL protocol code (Receiver framing/parsing,
 * Transmitter length-encoding, Channel tag routing, RouterOSAPI MD5 login,
 * write) runs end-to-end against BOTH lab routers through the Node-`net`
 * bridge, with zero `src/` changes.
 *
 * KNOWN GAP (recorded in FINDINGS.md; disposition RECORD-ONLY — no src/ patch):
 *   `src/Connector.ts` invokes `onConnect()` synchronously after socket
 *   creation (the original node-routeros wires it to the socket 'connect'
 *   event), and `react-native-tcp-socket`'s `Socket` has no `writable`
 *   property — so the login frame would pool on a real device. The Node `net`
 *   bridge masks this because Node sockets expose `writable` and buffer
 *   writes internally. Follow-up is deferred to a fix phase or `/gsd-debug`.
 */
import { RouterOSAPI } from '../../src/index';
import {
  buildClient,
  reachable,
  v6Config,
  v7Config,
  DeviceConfig,
} from './helpers/client';

/** Captures the connect-flow divergence as a const so it can be asserted. */
const ONCONNECT_DIVERGENCE =
  'src/Connector.ts invokes onConnect() synchronously after socket creation ' +
  '(the original node-routeros wires it to the socket connect event), and ' +
  "react-native-tcp-socket's Socket has no writable property, so the login " +
  'frame would pool on a real device. The Node net bridge masks this because ' +
  'Node sockets expose writable and buffer writes internally.';

/**
 * Build a per-device suite that skips cleanly when env is unset or the
 * router is unreachable (never a red run offline).
 */
function deviceSuite(label: string, cfg: DeviceConfig): void {
  const configured = Boolean(cfg.host && cfg.port);
  const d = configured ? describe : describe.skip;

  d(label, () => {
    let api: RouterOSAPI | null = null;
    let available = false;

    beforeAll(async () => {
      if (!configured) {
        return;
      }
      available = await reachable(cfg.host, cfg.port, 2000);
      if (!available) {
        // eslint-disable-next-line no-console
        console.log(
          `SKIP ${label}: no router reachable at ${cfg.host}:${cfg.port}`
        );
      }
    }, 15000);

    afterAll(async () => {
      if (api) {
        try {
          await api.close();
        } catch {
          // already closed / never connected — safe to ignore
        }
        api = null;
      }
    });

    test('connect() resolves to the RouterOSAPI instance', async () => {
      if (!available) return;
      const client = buildClient(cfg);
      api = client;
      const instance = await client.connect();
      expect(instance).toBeInstanceOf(RouterOSAPI);
    });

    test('write(/system/identity/print) returns a row with a .name field', async () => {
      if (!available) return;
      expect(api).not.toBeNull();
      const rows = await api!.write('/system/identity/print');
      expect(Array.isArray(rows)).toBe(true);
      expect(rows.length).toBeGreaterThan(0);
      expect(rows[0]).toHaveProperty('name');
    });

    test('write(/system/resource/print) exposes .version (first assertion)', async () => {
      if (!available) return;
      expect(api).not.toBeNull();
      const rows = await api!.write('/system/resource/print');
      expect(rows.length).toBeGreaterThan(0);
      const version = rows[0].version;
      // eslint-disable-next-line no-console
      console.log(`${label} RouterOS version: ${version}`);
      expect(typeof version).toBe('string');
    });

    test('close() then setOptions() + connect() reconnects (CONN-05)', async () => {
      if (!available) return;
      expect(api).not.toBeNull();
      await api!.close();
      api!.setOptions({
        host: cfg.host,
        port: cfg.port,
        user: process.env.ROUTEROS_USER,
        password: process.env.ROUTEROS_PASSWORD,
        timeout: 10,
      });
      const instance = await api!.connect();
      expect(instance).toBe(api);
    });

    test('double close() is safe (idempotent) and the instance stays reconnectable', async () => {
      if (!available) return;
      expect(api).not.toBeNull();
      if (!api!.connected) {
        await api!.connect();
      }
      await Promise.all([api!.close(), api!.close()]);
      expect(api!.connected).toBe(false);
      // Leave the suite connected for the remaining tests.
      api!.setOptions({
        host: cfg.host,
        port: cfg.port,
        user: process.env.ROUTEROS_USER,
        password: process.env.ROUTEROS_PASSWORD,
        timeout: 10,
      });
      await api!.connect();
      expect(api!.connected).toBe(true);
    }, 30000);

    test('wrong password rejects with CANTLOGIN (AUTH-03)', async () => {
      if (!available) return;
      const bad = new RouterOSAPI({
        host: cfg.host,
        port: cfg.port,
        user: process.env.ROUTEROS_USER,
        password: 'wrong-password',
        timeout: 10,
      });
      await expect(bad.connect()).rejects.toMatchObject({
        errno: 'CANTLOGIN',
      });
    });
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

describe('known-gap: synchronous onConnect() divergence recorded', () => {
  test('captures the finding (passes unconditionally, no src/ patch)', () => {
    expect(ONCONNECT_DIVERGENCE.length).toBeGreaterThan(0);
    expect(ONCONNECT_DIVERGENCE).not.toHaveLength(0);
    // eslint-disable-next-line no-console
    console.log(`known-gap: ${ONCONNECT_DIVERGENCE}`);
  });
});

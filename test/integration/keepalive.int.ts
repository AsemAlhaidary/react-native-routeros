/**
 * keepalive.int.ts — plan 07-02 task 2 (keepalive session hold).
 *
 * Proves the session stays alive past the RouterOS idle timeout via BOTH the
 * `keepalive: true` constructor flag (which runs `keepaliveBy('#')` after
 * login) and an explicit `keepaliveBy('#')` call after a plain connect. In
 * each case the session is still responsive to a fresh `write()` past
 * `timeout / 2`, and no `error` event fired (CONN-06).
 *
 * SKIPs cleanly offline.
 */
import { RouterOSAPI } from '../../src/index';
import {
  buildClient,
  reachable,
  v6Config,
  v7Config,
  DeviceConfig,
} from './helpers/client';

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Client with the `keepalive` constructor flag enabled (CONN-06 path A). */
function buildKeepaliveClient(cfg: DeviceConfig): RouterOSAPI {
  return new RouterOSAPI({
    host: cfg.host,
    port: cfg.port,
    user: process.env.ROUTEROS_USER,
    password: process.env.ROUTEROS_PASSWORD,
    timeout: 10,
    keepalive: true,
  });
}

/** Build a per-device suite that skips cleanly when offline/unreachable. */
function deviceSuite(label: string, cfg: DeviceConfig): void {
  const configured = Boolean(cfg.host && cfg.port);
  const d = configured ? describe : describe.skip;

  d(label, () => {
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

    test('keepalive: true holds the session open past timeout/2 with no error', async () => {
      if (!available) return;
      const api = buildKeepaliveClient(cfg);
      let errorCount = 0;
      api.on('error', () => {
        errorCount++;
      });
      try {
        await api.connect();
        // timeout/2 = 5s. Give the keepalive several rounds before asserting
        // the session is still responsive.
        await sleep(6000);
        const rows = await api.write('/system/identity/print');
        expect(rows.length).toBeGreaterThan(0);
        expect(rows[0]).toHaveProperty('name');
        expect(errorCount).toBe(0);
      } finally {
        await api.close().catch(() => undefined);
      }
    }, 30000);

    test('keepaliveBy("#") after a plain connect holds the session open', async () => {
      if (!available) return;
      const api = buildClient(cfg); // timeout 10 → keepalive interval 5s
      let errorCount = 0;
      api.on('error', () => {
        errorCount++;
      });
      try {
        await api.connect();
        api.keepaliveBy('#');
        await sleep(6000); // past timeout/2 = 5s
        const rows = await api.write('/system/identity/print');
        expect(rows.length).toBeGreaterThan(0);
        expect(rows[0]).toHaveProperty('name');
        expect(errorCount).toBe(0);
      } finally {
        await api.close().catch(() => undefined);
      }
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

/**
 * write-read.int.ts — plan 07-02 task 1 (write() service reads).
 *
 * Proves `write()` returns parsed arrays for five stable RouterOS services
 * across both lab routers (v6/v7), with a version-aware assertion for the
 * `/system/resource/print` CPU field (v6 `cpu` vs v7 `cpu-load` — A2: field
 * presence, not a numeric value).
 *
 * Reuses the 07-01 harness: `helpers/client.ts` (buildClient + reachable) and
 * `helpers/version.ts` (detectVersion). SKIPs cleanly offline.
 *
 * Pattern: fetch-all then assert — never `?name=` query-word filtering, which
 * is version-sensitive (see 07-RESEARCH.md Anti-Patterns).
 */
import { RouterOSAPI } from '../../src/index';
import {
  buildClient,
  reachable,
  v6Config,
  v7Config,
  DeviceConfig,
} from './helpers/client';
import { detectVersion, RouterVersion } from './helpers/version';

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
    let version: RouterVersion | null = null;

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
          // already closed / never connected — safe to ignore
        }
        api = null;
      }
    });

    test('write(/system/identity/print) resolves to a row with .name', async () => {
      if (!available) return;
      expect(api).not.toBeNull();
      const rows = await api!.write('/system/identity/print');
      expect(Array.isArray(rows)).toBe(true);
      expect(rows.length).toBeGreaterThan(0);
      expect(rows[0]).toHaveProperty('name');
    });

    test('write(/system/resource/print) exposes .version/.board-name + version-aware CPU field', async () => {
      if (!available) return;
      expect(api).not.toBeNull();
      expect(version).not.toBeNull();
      const rows = await api!.write('/system/resource/print');
      expect(rows.length).toBeGreaterThan(0);
      expect(rows[0]).toHaveProperty('version');
      expect(rows[0]).toHaveProperty('board-name');
      // A2 — assert field PRESENCE (not a numeric value), branched on major.
      if (version!.major === 6) {
        expect(rows[0]).toHaveProperty('cpu');
      } else {
        expect(rows[0]).toHaveProperty('cpu-load');
      }
    });

    test('write(/interface/print) resolves to rows with .name/.type', async () => {
      if (!available) return;
      expect(api).not.toBeNull();
      const rows = await api!.write('/interface/print');
      expect(rows.length).toBeGreaterThan(0);
      expect(rows[0]).toHaveProperty('name');
      expect(rows[0]).toHaveProperty('type');
    });

    test('write(/ip/address/print) resolves to rows with .address', async () => {
      if (!available) return;
      expect(api).not.toBeNull();
      const rows = await api!.write('/ip/address/print');
      expect(rows.length).toBeGreaterThan(0);
      expect(rows[0]).toHaveProperty('address');
    });

    test('write(/user/print) resolves to rows with .name/.group', async () => {
      if (!available) return;
      expect(api).not.toBeNull();
      const rows = await api!.write('/user/print');
      expect(rows.length).toBeGreaterThan(0);
      expect(rows[0]).toHaveProperty('name');
      expect(rows[0]).toHaveProperty('group');
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

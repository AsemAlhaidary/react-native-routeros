/**
 * _probe-bulk-users-cap.int.ts — TEMPORARY capability probe (deleted after).
 *
 * Confirms exact v6 semantics of `create-and-activate-profile` before any
 * 10k bulk run:
 *   1. existing profiles (does "Alpha 4000 YER" exist?)
 *   2. user/add single
 *   3. user/add with numbers= (batch create?)
 *   4. create-and-activate-profile on an EXISTING user (response shape via
 *      writeStream, profile applied, activation fields)
 */
import { RouterOSAPI } from '../../src/index';
import { buildClient, reachable, v6Config } from './helpers/client';

const CAP = `gsd-load-cap-${Date.now().toString(36)}`;

describe('PROBE cap create-and-activate-profile (v6)', () => {
  const cfg = v6Config();
  const configured = Boolean(cfg.host && cfg.port);
  const d = configured ? describe : describe.skip;

  let api: RouterOSAPI | null = null;
  let available = false;

  d('capability', () => {
    beforeAll(async () => {
      if (!configured) return;
      available = await reachable(cfg.host, cfg.port, 2000);
      if (!available) return;
      api = buildClient(cfg);
      await api.connect();
    }, 60000);

    afterAll(async () => {
      if (api) {
        try {
          await api.close();
        } catch {
          // already closed
        }
        api = null;
      }
    }, 60000);

    test('list profiles matching Alpha', async () => {
      if (!available || !api) return;
      const rows = await api.write('/tool/user-manager/profile/print');
      const alpha = rows.filter((r: Record<string, any>) =>
        String(r.name || '').toLowerCase().includes('alpha')
      );
      console.log(
        `PROFILES total=${rows.length} alpha-matching=${JSON.stringify(alpha)}`
      );
      expect(rows.length).toBeGreaterThan(0);
    }, 60000);

    test('user/add single creates a user', async () => {
      if (!available || !api) return;
      const name = `${CAP}-u1`;
      const res = await api.write([
        '/tool/user-manager/user/add',
        `=username=${name}`,
        '=password=gsd-load-pw',
        '=customer=asem',
      ]);
      console.log(`user/add single response: ${JSON.stringify(res)}`);
      const rows = await api.write(
        '/tool/user-manager/user/print',
        `?username=${name}`
      );
      console.log(`printed: ${JSON.stringify(rows)}`);
      expect(rows).toHaveLength(1);
    }, 60000);

    test('user/add with numbers= creates a batch', async () => {
      if (!available || !api) return;
      const names = [`${CAP}-n1`, `${CAP}-n2`, `${CAP}-n3`];
      try {
        const res = await api.write([
          '/tool/user-manager/user/add',
          `=numbers=${names.join(',')}`,
          '=password=gsd-load-pw',
          '=customer=asem',
        ]);
        console.log(`user/add numbers= response: ${JSON.stringify(res)}`);
      } catch (e) {
        console.log(`user/add numbers= trapped: ${(e as Error).message}`);
      }
      const rows = await api.write(
        '/tool/user-manager/user/print',
        `?username=${CAP}-n`
      );
      console.log(`after numbers= add, prefix ${CAP}-n: ${rows.length} rows`);
    }, 60000);

    test('create-and-activate-profile on EXISTING user (writeStream shape)', async () => {
      if (!available || !api) return;
      const name = `${CAP}-u1`;

      const dataEvents: unknown[] = [];
      const doneArgs: unknown[] = [];
      const traps: unknown[] = [];
      let done = false;

      await new Promise<void>((resolve, reject) => {
        const s = api!.writeStream([
          '/tool/user-manager/user/create-and-activate-profile',
          `=numbers=${name}`,
          '=customer=asem',
          '=profile=Alpha 4000 YER',
        ]);
        s.on('data', (p: unknown) => dataEvents.push(p));
        s.on('done', (arg: unknown) => {
          doneArgs.push(arg);
          done = true;
          resolve();
        });
        s.on('trap', (t: unknown) => traps.push(t));
        s.on('error', (e: Error) => reject(e));
      });

      console.log(
        `create-and-activate: dataEvents=${JSON.stringify(dataEvents)} doneArgs=${JSON.stringify(doneArgs)} done=${done} traps=${JSON.stringify(traps)}`
      );
      expect(done).toBe(true);
      expect(traps).toHaveLength(0);

      const rows = await api.write(
        '/tool/user-manager/user/print',
        `?username=${name}`
      );
      console.log(`after activate, row: ${JSON.stringify(rows[0])}`);
      expect(rows).toHaveLength(1);
      const row = rows[0];
      expect(row.profile).toBe('Alpha 4000 YER');
    }, 60000);
  });
});
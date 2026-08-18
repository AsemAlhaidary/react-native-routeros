/**
 * _probe-diag-users.int.ts — TEMPORARY diagnostic (deleted after).
 * Reports the actual state of gsd-load users on the v6 lab router after the
 * partial bulk run.
 */
import { RouterOSAPI } from '../../src/index';
import { buildClient, reachable, v6Config } from './helpers/client';

describe('PROBE diag gsd-load users (v6)', () => {
  const cfg = v6Config();
  const configured = Boolean(cfg.host && cfg.port);
  const d = configured ? describe : describe.skip;

  let api: RouterOSAPI | null = null;
  let available = false;

  d('diag', () => {
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

    test('count + list gsd-load users', async () => {
      if (!available || !api) return;
      const total = await api.write(['/tool/user-manager/user/print', '=count-only=yes']);
      console.log(`count-only total: ${JSON.stringify(total)}`);

      const rows = await api.write(
        '/tool/user-manager/user/print',
        '?username~^gsd-load-'
      );
      console.log(`rows matching ^gsd-load-: ${rows.length}`);
      const ids = rows.map((r: Record<string, any>) => r.username);
      ids.sort();
      console.log(`first 20: ${JSON.stringify(ids.slice(0, 20))}`);
      console.log(`last 20: ${JSON.stringify(ids.slice(-20))}`);

      const withProfile = rows.filter(
        (r: Record<string, any>) => (r['actual-profile'] || '') === 'Alpha 4000 YER'
      );
      console.log(`of those, actual-profile Alpha 4000 YER: ${withProfile.length}`);
    }, 120000);
  });
});
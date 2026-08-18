/**
 * _probe-bulk-10k-users.int.ts — TEMPORARY bulk run (deleted after).
 *
 * On the real v6 lab router: create 10,000 user-manager users and activate
 * each with the "Alpha 4000 YER" profile, measuring wall-clock time.
 *
 * Approach (confirmed by the capability probe):
 *   - `user/add` takes ONE user per command (`numbers=` traps) → add the 10k
 *     via pipelined writes (chunks of 500, Promise.all per chunk — RouterOS
 *     processes commands in order over the one connection, tags multiplex).
 *   - `create-and-activate-profile numbers=u1,u2,... profile=...` accepts a
 *     comma-separated batch → activate 500 users per command.
 *   - writeStream() was probed and shows the activation command returns a
 *     single `!done` (no per-user `!re` stream) — NOT a streaming endpoint.
 *
 * No cleanup — lab router, per request.
 */
import { RouterOSAPI } from '../../src/index';
import { buildClient, reachable, v6Config } from './helpers/client';

const PROFILE = 'Alpha 4000 YER';
const COUNT = 10000;
const CHUNK = 500;
const PREFIX = 'gsd-load';
const PASSWORD = 'gsd-load-pw';

const names = (from: number, n: number): string[] => {
  const out: string[] = [];
  for (let i = from; i < from + n; i++) {
    out.push(`${PREFIX}-${String(i).padStart(5, '0')}`);
  }
  return out;
};

const addCmd = (username: string): string[] => [
  '/tool/user-manager/user/add',
  `=username=${username}`,
  `=password=${PASSWORD}`,
  '=customer=asem',
];

const activateCmd = (usernames: string[]): string[] => [
  '/tool/user-manager/user/create-and-activate-profile',
  `=numbers=${usernames.join(',')}`,
  '=customer=asem',
  `=profile=${PROFILE}`,
];

async function countUsers(api: RouterOSAPI): Promise<number> {
  const rows = await api.write(['/tool/user-manager/user/print', '=count-only=yes']);
  const ret = rows[0] && rows[0].ret;
  return typeof ret === 'string' ? parseInt(ret, 10) : NaN;
}

describe('PROBE bulk 10k users + activate (v6)', () => {
  const cfg = v6Config();
  const configured = Boolean(cfg.host && cfg.port);
  const d = configured ? describe : describe.skip;

  let api: RouterOSAPI | null = null;
  let available = false;
  let baseline = NaN;

  d('bulk 10k', () => {
    beforeAll(async () => {
      if (!configured) return;
      available = await reachable(cfg.host, cfg.port, 2000);
      if (!available) return;
      api = buildClient(cfg);
      await api.connect();
      baseline = await countUsers(api);
      console.log(`BASELINE user count: ${baseline}`);
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

    test('verify: batch create-and-activate-profile (5 users)', async () => {
      if (!available || !api) return;
      const verify = names(0, 5);
      for (const n of verify) {
        await api.write(addCmd(n));
      }
      await api.write(activateCmd(verify));
      for (const n of verify) {
        const rows = await api.write(
          '/tool/user-manager/user/print',
          `?username=${n}`
        );
        expect(rows).toHaveLength(1);
        expect(rows[0]['actual-profile']).toBe(PROFILE);
      }
      console.log(`verify: 5 users activated with ${PROFILE} in one numbers= command`);
    }, 120000);

    test(`create ${COUNT} users (pipelined user/add) + measure`, async () => {
      if (!available || !api) return;
      const t0 = Date.now();
      const perChunk: number[] = [];
      for (let start = 0; start < COUNT; start += CHUNK) {
        const chunk = names(start, CHUNK);
        const t = Date.now();
        await Promise.all(chunk.map((n) => api!.write(addCmd(n))));
        perChunk.push(Date.now() - t);
      }
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(
        `ADD ${COUNT} users: total=${elapsed}s chunk(500)ms=${JSON.stringify(perChunk)}`
      );

      const now = await countUsers(api);
      console.log(`ADD verification: count now=${now} (baseline=${baseline}, delta=${now - baseline})`);
      expect(now - baseline).toBe(COUNT + 5);
    }, 900000);

    test(`activate ${COUNT} users (batched numbers=) + measure`, async () => {
      if (!available || !api) return;
      const t0 = Date.now();
      const perChunk: number[] = [];
      for (let start = 0; start < COUNT; start += CHUNK) {
        const chunk = names(start, CHUNK);
        const t = Date.now();
        await api.write(activateCmd(chunk));
        perChunk.push(Date.now() - t);
      }
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(
        `ACTIVATE ${COUNT} users: total=${elapsed}s chunk(500)ms=${JSON.stringify(perChunk)}`
      );

      const samples = [0, 1234, 5678, 9999].map((i) => names(i, 1)[0]);
      for (const n of samples) {
        const rows = await api.write(
          '/tool/user-manager/user/print',
          `?username=${n}`
        );
        expect(rows).toHaveLength(1);
        expect(rows[0]['actual-profile']).toBe(PROFILE);
        console.log(`sample ${n}: actual-profile=${JSON.stringify(rows[0]['actual-profile'])} active=${rows[0].active}`);
      }
    }, 900000);
  });
});
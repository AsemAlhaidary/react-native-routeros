/**
 * writeStream.int.ts — plan 07-02 task 1 (writeStream() finite streaming + trap).
 *
 * Proves `writeStream()` emits `data` → `done` → `close` on a finite command
 * (`/interface/print`), and emits `trap` on an invalid command (CMDS-02 error
 * path). Runs against both lab routers; SKIPs cleanly offline.
 *
 * Reuses the 07-01 harness (`helpers/client.ts` buildClient + reachable).
 */
import { RouterOSAPI, RStream } from '../../src/index';
import {
  buildClient,
  reachable,
  v6Config,
  v7Config,
  DeviceConfig,
} from './helpers/client';

/** Build a per-device suite that skips cleanly when offline/unreachable. */
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
        return;
      }
      const client = buildClient(cfg);
      api = client;
      await client.connect();
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

    test('writeStream(/interface/print) emits data then done then close', async () => {
      if (!available) return;
      expect(api).not.toBeNull();

      const sentences: Record<string, any>[] = [];
      const order: string[] = [];
      const stream: RStream = api!.writeStream(['/interface/print']);

      await new Promise<void>((resolve, reject) => {
        stream.on('data', (packet: Record<string, any>) => {
          sentences.push(packet);
          order.push('data');
        });
        stream.on('done', () => order.push('done'));
        stream.on('close', () => {
          order.push('close');
          resolve();
        });
        stream.on('trap', (trap: Record<string, any>) => {
          reject(new Error(`unexpected trap: ${trap.message}`));
        });
        stream.on('error', (err: any) => {
          reject(new Error(`unexpected stream error: ${err && err.message}`));
        });
      });

      // At least one sentence arrived, and the lifecycle fired in order:
      // all data before done before close.
      expect(sentences.length).toBeGreaterThan(0);
      expect(order.indexOf('done')).toBeGreaterThan(order.lastIndexOf('data'));
      expect(order.indexOf('close')).toBeGreaterThan(order.indexOf('done'));
    }, 30000);

    test('writeStream(/definitely/not/a/command) emits trap with a message', async () => {
      if (!available) return;
      expect(api).not.toBeNull();

      const stream: RStream = api!.writeStream(['/definitely/not/a/command']);

      const trap = await new Promise<Record<string, any>>((resolve, reject) => {
        stream.on('trap', (data: Record<string, any>) => resolve(data));
        stream.on('error', () => {
          // trap also emits 'error' (writeStream has no callback) — swallow it;
          // the 'trap' listener above is the assertion target.
        });
        stream.on('data', () => {
          reject(new Error('unexpected data on invalid command'));
        });
        stream.on('done', () => {
          reject(new Error('unexpected done on invalid command'));
        });
      });

      expect(typeof trap.message).toBe('string');
      expect(trap.message.length).toBeGreaterThan(0);
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

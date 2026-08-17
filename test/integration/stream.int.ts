/**
 * stream.int.ts — plan 07-02 task 2 (stream() continuous streaming).
 *
 * Proves `stream()` on a continuous endpoint (`/interface/monitor-traffic`)
 * emits `data`, honors `pause()`/`resume()`/`stop()`, and produces no repeated
 * empty-data bursts (STRM-04). SKIPs cleanly offline; also skips a device when
 * the monitor-traffic endpoint `!trap`s (e.g. unsupported interface).
 *
 * Reuses the 07-01 harness (`helpers/client.ts` buildClient + reachable).
 *
 * NOTE (deviation from plan): the plan suggested `=once=`. `once` bounds
 * monitor-traffic to a single sample, which would leave nothing to observe
 * across pause/resume/stop, so the command here is the continuous form
 * (no `once`) — it streams every second until the `/cancel` that pause/stop
 * send.
 */
import { RouterOSAPI, RStream } from '../../src/index';
import {
  buildClient,
  reachable,
  v6Config,
  v7Config,
  DeviceConfig,
} from './helpers/client';

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Poll `cond` until it returns true or `timeoutMs` elapses. */
async function waitFor(
  cond: () => boolean,
  timeoutMs: number,
  intervalMs = 200
): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor: condition not met within timeout');
    }
    await sleep(intervalMs);
  }
}

/** A sampled data packet: arrival time + number of keys (0 ⇒ debounced empty). */
interface Sample {
  t: number;
  keys: number;
}

/** Build a per-device suite that skips cleanly when offline/unreachable. */
function deviceSuite(label: string, cfg: DeviceConfig): void {
  const configured = Boolean(cfg.host && cfg.port);
  const d = configured ? describe : describe.skip;

  d(label, () => {
    let api: RouterOSAPI | null = null;
    let available = false;
    let firstInterface = '';

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
      const ifaces = await client.write('/interface/print');
      firstInterface = (ifaces[0] && ifaces[0].name) || '';
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

    test('stream() emits data and honors pause/resume/stop without empty bursts', async () => {
      if (!available) return;
      expect(api).not.toBeNull();

      if (!firstInterface) {
        // eslint-disable-next-line no-console
        console.log(
          `SKIP stream for ${label}: no interface available to monitor`
        );
        return;
      }

      const samples: Sample[] = [];
      const traps: Record<string, any>[] = [];

      const stream: RStream = api!.stream([
        '/interface/monitor-traffic',
        `=interface=${firstInterface}`,
      ]);

      stream.on('data', (packet: Record<string, any>) => {
        samples.push({ t: Date.now(), keys: Object.keys(packet).length });
      });
      stream.on('trap', (t: Record<string, any>) => {
        traps.push(t);
      });
      stream.on('error', () => {
        // trap also emits 'error' (stream() has no callback) — swallow it;
        // 'trap' is the signal for endpoint-unsupported skip below.
      });

      // Wait for the first sample (or a trap on this endpoint/device).
      await waitFor(() => samples.length > 0 || traps.length > 0, 10000);

      if (traps.length > 0) {
        // eslint-disable-next-line no-console
        console.log(
          `SKIP stream for ${label}: /interface/monitor-traffic trap: ${traps[0].message}`
        );
        await stream.stop().catch(() => undefined);
        return;
      }

      expect(samples.length).toBeGreaterThan(0);

      // pause: no new data during a short window
      await stream.pause();
      const afterPause = samples.length;
      await sleep(2500);
      expect(samples.length).toBe(afterPause);

      // resume: data resumes
      await stream.resume();
      await waitFor(() => samples.length > afterPause, 10000);
      expect(samples.length).toBeGreaterThan(afterPause);

      // stop: no further data
      await stream.stop();
      const afterStop = samples.length;
      await sleep(2500);
      expect(samples.length).toBe(afterStop);

      // STRM-04: real (non-empty) data arrived, and any empty packets are the
      // debounced keep-alive heartbeat — never a tight burst.
      const nonEmpty = samples.filter((s) => s.keys > 0);
      expect(nonEmpty.length).toBeGreaterThan(0);
      for (let i = 1; i < samples.length; i++) {
        if (samples[i].keys === 0 && samples[i - 1].keys === 0) {
          // Consecutive empty packets must be spaced by the debounce interval
          // (>= 1800ms), not emitted back-to-back.
          expect(samples[i].t - samples[i - 1].t).toBeGreaterThanOrEqual(1800);
        }
      }
    }, 45000);
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

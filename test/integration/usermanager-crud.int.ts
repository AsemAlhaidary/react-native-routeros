/**
 * usermanager-crud.int.ts — plan 07-03 task 2 (v6/v7 User Manager CRUD).
 *
 * Proves create→read→update→read→delete→verify-gone for profiles and users on
 * BOTH lab routers using the per-version recipe (`/user-manager` on v7,
 * `/tool user-manager` on v6 — ASSUMED), plus the v7-only user-profile link and
 * router entities. Every created entity carries a unique `ROUTEROS_PREFIX`
 * name and is removed inline AND via the afterAll `sweepByPrefix` (T-07-03) so
 * no garbage accumulates on the lab routers even on failure.
 *
 * If User Manager is unavailable (`enable` !traps) or the device is
 * unreachable, the device describe skips (exit 0).
 */
import { RouterOSAPI } from '../../src/index';
import {
  buildClient,
  reachable,
  v6Config,
  v7Config,
  DeviceConfig,
} from './helpers/client';
import { detectVersion, selectRecipe, RouterVersion } from './helpers/version';
import {
  makeName,
  runCrud,
  sweepByPrefix,
  testPrefix,
  RecipeModule,
} from './helpers/crud';

/** Build a per-device suite that skips cleanly when offline/unreachable. */
function deviceSuite(label: string, cfg: DeviceConfig): void {
  const configured = Boolean(cfg.host && cfg.port);
  const d = configured ? describe : describe.skip;

  d(label, () => {
    let api: RouterOSAPI | null = null;
    let available = false;
    let version: RouterVersion | null = null;
    let recipe: RecipeModule | null = null;
    let userManagerAvailable = false;
    const prefix = testPrefix();

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
      recipe = await selectRecipe(client, version);

      // Pre-flight: enable User Manager. May !trap on unlicensed/disabled
      // devices (Pitfall 6) — in that case skip this device's describe.
      try {
        await client.write(recipe.userManager.enable);
        userManagerAvailable = true;
      } catch (e) {
        // eslint-disable-next-line no-console
        console.log(
          `SKIP ${label}: User Manager unavailable — ${(e as Error).message}`
        );
        userManagerAvailable = false;
      }
    }, 60000);

    afterAll(async () => {
      if (api && available && recipe) {
        // Idempotent sweep of any leftover profile/user entities (T-07-03).
        const sweeps: Array<() => Promise<void>> = [
          () =>
            sweepByPrefix(
              api!,
              recipe!,
              recipe!.userManager.profileRead,
              recipe!.userManager.profileDel,
              prefix
            ),
          // v6 user sweep fetch-alls 40,860 users — needs the 60s socket/test
          // window (old 10s timeout hung the connection).
          () =>
            sweepByPrefix(
              api!,
              recipe!,
              recipe!.userManager.userRead,
              recipe!.userManager.userDel,
              prefix
            ),
        ];
        for (const sweep of sweeps) {
          try {
            await sweep();
          } catch {
            // best-effort — a failed sweep must not mask the real result
          }
        }
      }
      if (api) {
        try {
          await api.close();
        } catch {
          // already closed / never connected — safe to ignore
        }
        api = null;
      }
    }, 60000);

    test('profile CRUD: add → read → set validity → read → del → gone', async () => {
      if (!available || !userManagerAvailable) return;
      expect(recipe).not.toBeNull();
      await runCrud(api!, recipe!, 'profile', {
        add: (name) => recipe!.userManager.profileAdd(name),
        read: () => recipe!.userManager.profileRead(),
        set: (id) => recipe!.userManager.profileSet(id, '2d'),
        del: (id) => recipe!.userManager.profileDel(id),
        fieldForName: 'name', // profiles use `name` on both v6 and v7
        prefix,
      });
    }, 60000);

    test('user CRUD: add → read → set password → read → del → gone', async () => {
      if (!available || !userManagerAvailable) return;
      expect(recipe).not.toBeNull();
      // v6 user add needs `=customer=asem` (hardcoded in recipes/v6.ts). The
      // lab v6 user table has 40,860 rows and each fetch-all takes ~23s
      // (measured), so this test's THREE reads need a 120s window — the 60s
      // window timed out cleanly with the Receiver fix in place.
      await runCrud(api!, recipe!, 'user', {
        add: (name) => recipe!.userManager.userAdd(name, 'gsd-itest-pw'),
        read: () => recipe!.userManager.userRead(),
        set: (id) => recipe!.userManager.userSet(id, 'gsd-itest-pw-2'),
        del: (id) => recipe!.userManager.userDel(id),
        fieldForName: recipe!.fieldForName, // v6 `username` / v7 `name`
        prefix,
      });
    }, 120000);

    test('link: user-profile add → read → remove (v7 only)', async () => {
      if (!available || !userManagerAvailable) return;
      expect(recipe).not.toBeNull();
      // v6 has no user-profile link table — recipe.linkAdd is a throwing stub.
      if (version!.major !== 7) return;

      const um = recipe!.userManager;
      const userName = makeName(prefix);
      const profileName = makeName(prefix);
      try {
        await api!.write(um.profileAdd(profileName));
        await api!.write(um.userAdd(userName, 'gsd-itest-pw'));
        await api!.write(um.linkAdd(userName, profileName));

        const links = await api!.write(um.linkRead());
        const row = links.find(
          (l) => l.user === userName && l.profile === profileName
        );
        expect(row).toBeDefined();
        const linkId = row?.['.id'];
        expect(linkId).toBeDefined();

        await api!.write(um.linkDel(linkId as string));
        const after = await api!.write(um.linkRead());
        expect(
          after.find((l) => l.user === userName && l.profile === profileName)
        ).toBeUndefined();
      } finally {
        // clean up the supporting user + profile
        try {
          await sweepByPrefix(api!, recipe!, um.profileRead, um.profileDel, prefix);
        } catch {
          // best-effort
        }
        try {
          await sweepByPrefix(api!, recipe!, um.userRead, um.userDel, prefix);
        } catch {
          // best-effort
        }
      }
    }, 60000);

    test('router: add → read → remove (v7 only)', async () => {
      if (!available || !userManagerAvailable) return;
      expect(recipe).not.toBeNull();
      if (version!.major !== 7) return; // v6 has no router — throwing stub

      const um = recipe!.userManager;
      const name = makeName(prefix);
      try {
        await api!.write(um.routerAdd(name));
        const routers = await api!.write(um.routerRead());
        const row = routers.find((r) => r.name === name);
        expect(row).toBeDefined();
        const routerId = row?.['.id'];
        expect(routerId).toBeDefined();
        await api!.write(um.routerDel(routerId as string));
        const after = await api!.write(um.routerRead());
        expect(after.find((r) => r.name === name)).toBeUndefined();
      } finally {
        try {
          await sweepByPrefix(api!, recipe!, um.routerRead, um.routerDel, prefix);
        } catch {
          // best-effort
        }
      }
    }, 60000);
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

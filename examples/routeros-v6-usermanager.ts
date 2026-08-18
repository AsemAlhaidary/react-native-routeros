/**
 * routeros-v6-usermanager.ts — create User Manager users on RouterOS v6 and
 * activate them with a profile.
 *
 * Verified against a real RouterOS v6 device. Two v6 quirks drive the design:
 *
 *   1. `/tool/user-manager/user add` takes ONE user per command. `=numbers=` is
 *      not supported on `user/add` in v6 and traps with "unknown parameter".
 *      The response resolves to `[{ ret: "*19025" }]` — the new user's id is in
 *      the `ret` field and equals the item's `.id`.
 *
 *   2. `/tool/user-manager/user create-and-activate-profile` targets EXISTING
 *      users and accepts a comma-separated batch in `=numbers=`, so many users
 *      are activated with a single command. After activation each user row
 *      gains an `actual-profile` field (the profile shows there, not in the
 *      `profile` field).
 *
 * So: create users individually (pipelined for throughput), then activate the
 * whole set with a handful of batched commands.
 *
 * NOTE: The credentials/profile/customer below are placeholders. In a real app
 * load them from environment variables or a secure key store — never hardcode
 * real credentials.
 */
import { RouterOSAPI, RosException } from 'react-native-routeros';

interface UserManagerRow {
  '.id'?: string;
  username?: string;
  'actual-profile'?: string;
}

async function userManagerExample(): Promise<void> {
  const api = new RouterOSAPI({
    host: '192.168.88.1',
    user: 'admin',
    password: 'password',
    timeout: 10,
  });

  try {
    // connect() opens the TCP/TLS connection and logs in automatically.
    await api.connect();
  } catch (err) {
    if (err instanceof RosException) {
      console.error('RouterOS error:', err.errno, err.message);
    } else {
      console.error('Unexpected error:', err);
    }
    return;
  }

  const customer = 'admin'; // must already exist in User Manager
  const profile = 'profile1'; // must already exist in User Manager
  const names = ['alice', 'bob', 'carol'];

  try {
    // ── 1. Create users ──
    // One `add` command per user (v6 does not accept `=numbers=` here). Each
    // write() opens its own tagged channel, so pipeline and await together.
    const created = await Promise.all(
      names.map((username) =>
        api.write('/tool/user-manager/user/add', [
          `=username=${username}`,
          '=password=change-me',
          `=customer=${customer}`,
        ])
      )
    );

    // The new id comes back in the `ret` field and equals the item's `.id`.
    for (let i = 0; i < created.length; i++) {
      const id = created[i][0]?.ret as string | undefined;
      console.log(`Created ${names[i]}: id=${id}`);
    }

    // ── 2. Activate users with a profile ──
    // `create-and-activate-profile` targets existing users and takes a
    // comma-separated `=numbers=` batch — one command activates them all.
    await api.write('/tool/user-manager/user/create-and-activate-profile', [
      `=numbers=${names.join(',')}`,
      `=customer=${customer}`,
      `=profile=${profile}`,
    ]);
    console.log(`Activated ${names.join(', ')} with profile "${profile}"`);

    // ── 3. Verify ──
    // Filter a print by username (exact match). The profile shows up under
    // `actual-profile` after activation.
    for (const username of names) {
      const rows = (await api.write('/tool/user-manager/user/print', [
        `?username=${username}`,
      ])) as UserManagerRow[];
      const row = rows[0];
      console.log(
        `${username}: .id=${row?.['.id']} actual-profile=${row?.['actual-profile']}`
      );
    }

    // ── 4. Bulk-loading many users ──
    // Creating 10k users means 10k `add` commands. Pipeline them in chunks of a
    // few hundred with Promise.all so memory stays bounded; then a single
    // `create-and-activate-profile` batch activates them all.
    const bulkNames: string[] = [];
    for (let i = 0; i < 20; i++) {
      bulkNames.push(`bulk-${String(i).padStart(3, '0')}`);
    }

    const CHUNK = 100;
    for (let start = 0; start < bulkNames.length; start += CHUNK) {
      const chunk = bulkNames.slice(start, start + CHUNK);
      await Promise.all(
        chunk.map((username) =>
          api.write('/tool/user-manager/user/add', [
            `=username=${username}`,
            '=password=change-me',
            `=customer=${customer}`,
          ])
        )
      );
    }

    await api.write('/tool/user-manager/user/create-and-activate-profile', [
      `=numbers=${bulkNames.join(',')}`,
      `=customer=${customer}`,
      `=profile=${profile}`,
    ]);
    console.log(`Bulk-created and activated ${bulkNames.length} users`);
  } catch (err) {
    // A command !trap (e.g. "such username already exists") rejects with a
    // plain Error — its .message is the trap text.
    console.error('Command failed:', (err as Error).message);
  } finally {
    // Gracefully close the connection.
    await api.close();
  }
}

export default userManagerExample;
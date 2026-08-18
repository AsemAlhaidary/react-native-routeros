/**
 * recipes/v6.ts — RouterOS v6 User Manager command arrays (plan 07-03).
 *
 * CONFIRMED against the lab v6 router (6.49.7): User Manager lives under
 * `/tool user-manager` with `profile` and `user` entities; the USER name field
 * is `username` (v7 uses `name`); set/remove target the API wire-form `=.id=`.
 * v6 has NO enable/disable command — `enable` is an availability probe.
 *
 * v6 has no `user-profile` link table or `router` entity (v7 concepts) — those
 * commands are throwing stubs so a caller fails loudly instead of silently
 * sending wrong command paths.
 */
import type { UserManagerRecipe } from '../helpers/crud';

/** v6 USER entity name field (CONFIRMED). */
export const fieldForName = 'username' as const;

export const userManager: UserManagerRecipe = {
  // v6 has NO enable/disable command — the package is enabled by default once
  // installed (confirmed on lab 6.49.7). This is an availability probe: it
  // !traps when the package is missing, which the suite reads as "unavailable".
  enable: ['/tool/user-manager/profile/print'],
  // CONFIRMED: v6 profile add uses =name= and =validity= but MUST also carry
  // =owner=<customer login> ("customer does not exist" otherwise) — v6 UM
  // profiles are customer-owned and `asem` is the lab's root customer.
  profileAdd: (name: string) => [
    '/tool/user-manager/profile/add',
    `=name=${name}`,
    '=validity=1d',
    '=owner=asem',
  ],
  profileRead: () => ['/tool/user-manager/profile/print'],
  profileSet: (id: string, validity: string) => [
    '/tool/user-manager/profile/set',
    `=.id=${id}`,
    `=validity=${validity}`,
  ],
  profileDel: (id: string) => ['/tool/user-manager/profile/remove', `=.id=${id}`],
  // CONFIRMED: v6 user add uses =username= (not v7's =name=) and ALSO requires
  // =customer=<customer> ("owner is required" otherwise). The root customer
  // login on the lab is `asem` — hardcoded here exactly like `=owner=asem` for
  // profiles. v6 user CRUD runs in the suite now that the socket timeout is 60s
  // (a full user/print fetch of the lab's 40,860 users needs >10s).
  userAdd: (name: string, password: string) => [
    '/tool/user-manager/user/add',
    `=username=${name}`,
    `=password=${password}`,
    '=customer=asem',
  ],
  userRead: () => ['/tool/user-manager/user/print'],
  userSet: (id: string, password: string) => [
    '/tool/user-manager/user/set',
    `=.id=${id}`,
    `=password=${password}`,
  ],
  userDel: (id: string) => ['/tool/user-manager/user/remove', `=.id=${id}`],
  // v6 has no user-profile link table — record finding, never send bad commands.
  linkAdd: () => {
    throw new Error('v6 link/router not yet confirmed — record finding');
  },
  linkRead: () => {
    throw new Error('v6 link/router not yet confirmed — record finding');
  },
  linkDel: () => {
    throw new Error('v6 link/router not yet confirmed — record finding');
  },
  routerAdd: () => {
    throw new Error('v6 link/router not yet confirmed — record finding');
  },
  routerRead: () => {
    throw new Error('v6 link/router not yet confirmed — record finding');
  },
  routerDel: () => {
    throw new Error('v6 link/router not yet confirmed — record finding');
  },
};

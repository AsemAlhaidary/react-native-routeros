/**
 * recipes/v6.ts — RouterOS v6 User Manager command arrays (plan 07-03).
 *
 * ASSUMED paths/fields (research confidence LOW — see 07-RESEARCH.md A1): v6
 * User Manager lives under `/tool user-manager` and the USER name field is
 * `username` (v7 uses `name`). Each command is marked ASSUMED and is confirmed
 * against the live v6 router by the suite's read-back-before-assert pattern
 * (any wrong field is self-diagnosing).
 *
 * v6 has no `user-profile` link table or `router` entity (v7 concepts) — those
 * commands are throwing stubs so a caller fails loudly instead of silently
 * sending wrong command paths.
 */
import type { UserManagerRecipe } from '../helpers/crud';

/** v6 USER entity name field (ASSUMED). */
export const fieldForName = 'username' as const;

export const userManager: UserManagerRecipe = {
  // ASSUMED: v6 User Manager prefix is /tool user-manager (not /user-manager).
  enable: ['/tool/user-manager/set', '=enabled=yes'],
  // ASSUMED: v6 profile add uses =name= and =validity=.
  profileAdd: (name: string) => [
    '/tool/user-manager/profile/add',
    `=name=${name}`,
    '=validity=1d',
  ],
  profileRead: () => ['/tool/user-manager/profile/print'],
  profileSet: (id: string, validity: string) => [
    '/tool/user-manager/profile/set',
    `.id=${id}`,
    `=validity=${validity}`,
  ],
  profileDel: (id: string) => ['/tool/user-manager/profile/remove', `.id=${id}`],
  // ASSUMED: v6 user add uses =username= (not v7's =name=).
  userAdd: (name: string, password: string) => [
    '/tool/user-manager/user/add',
    `=username=${name}`,
    `=password=${password}`,
  ],
  userRead: () => ['/tool/user-manager/user/print'],
  userSet: (id: string, password: string) => [
    '/tool/user-manager/user/set',
    `.id=${id}`,
    `=password=${password}`,
  ],
  userDel: (id: string) => ['/tool/user-manager/user/remove', `.id=${id}`],
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

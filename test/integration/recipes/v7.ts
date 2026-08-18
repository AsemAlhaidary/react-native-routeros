/**
 * recipes/v7.ts — RouterOS v7 User Manager command arrays (plan 07-03).
 *
 * CITED paths/fields from the official MikroTik docs
 * (help.mikrotik.com/docs/display/ROS/User+Manager): v7 User Manager lives
 * under `/user-manager` with `user`, `profile`, `user-profile` (the
 * user↔profile link table) and `router` (the NAS/RADIUS client, formerly the
 * v6 "customer" concept). The USER name field is `name`.
 */
import type { UserManagerRecipe } from '../helpers/crud';

/** Deterministic 1..254 octet from a name — keeps router addresses unique. */
function uniqueOctet(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = (h * 31 + name.charCodeAt(i)) % 254;
  }
  return h + 1;
}

/** v7 USER entity name field (v6 uses `username`). */
export const fieldForName = 'name' as const;

export const userManager: UserManagerRecipe = {
  enable: ['/user-manager/set', '=enabled=yes'],
  profileAdd: (name: string) => [
    '/user-manager/profile/add',
    `=name=${name}`,
    '=validity=1d',
  ],
  profileRead: () => ['/user-manager/profile/print'],
  profileSet: (id: string, validity: string) => [
    '/user-manager/profile/set',
    `=.id=${id}`,
    `=validity=${validity}`,
  ],
  profileDel: (id: string) => ['/user-manager/profile/remove', `=.id=${id}`],
  userAdd: (name: string, password: string) => [
    '/user-manager/user/add',
    `=name=${name}`,
    `=password=${password}`,
    '=group=default',
  ],
  userRead: () => ['/user-manager/user/print'],
  userSet: (id: string, password: string) => [
    '/user-manager/user/set',
    `=.id=${id}`,
    `=password=${password}`,
  ],
  userDel: (id: string) => ['/user-manager/user/remove', `=.id=${id}`],
  linkAdd: (user: string, profile: string) => [
    '/user-manager/user-profile/add',
    `=user=${user}`,
    `=profile=${profile}`,
  ],
  linkRead: () => ['/user-manager/user-profile/print'],
  linkDel: (id: string) => ['/user-manager/user-profile/remove', `=.id=${id}`],
  // CONFIRMED: v7 router address must be unique across ALL routers — the lab's
  // pre-existing `main-router` already owns `127.0.0.1` ("overlapping address"
  // otherwise), and IP:port form is rejected ("invalid or unexpected argument
  // base"). Derive a unique 10.255.255.x octet from the entity name instead.
  routerAdd: (name: string) => [
    '/user-manager/router/add',
    `=name=${name}`,
    `=address=10.255.255.${uniqueOctet(name)}`,
    '=shared-secret=gsdtest',
  ],
  routerRead: () => ['/user-manager/router/print'],
  routerDel: (id: string) => ['/user-manager/router/remove', `=.id=${id}`],
};

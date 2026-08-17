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
    `.id=${id}`,
    `=validity=${validity}`,
  ],
  profileDel: (id: string) => ['/user-manager/profile/remove', `.id=${id}`],
  userAdd: (name: string, password: string) => [
    '/user-manager/user/add',
    `=name=${name}`,
    `=password=${password}`,
    '=group=default',
  ],
  userRead: () => ['/user-manager/user/print'],
  userSet: (id: string, password: string) => [
    '/user-manager/user/set',
    `.id=${id}`,
    `=password=${password}`,
  ],
  userDel: (id: string) => ['/user-manager/user/remove', `.id=${id}`],
  linkAdd: (user: string, profile: string) => [
    '/user-manager/user-profile/add',
    `=user=${user}`,
    `=profile=${profile}`,
  ],
  linkRead: () => ['/user-manager/user-profile/print'],
  linkDel: (id: string) => ['/user-manager/user-profile/remove', `.id=${id}`],
  routerAdd: (name: string) => [
    '/user-manager/router/add',
    `=name=${name}`,
    '=address=127.0.0.1',
    '=shared-secret=gsdtest',
  ],
  routerRead: () => ['/user-manager/router/print'],
  routerDel: (id: string) => ['/user-manager/router/remove', `.id=${id}`],
};

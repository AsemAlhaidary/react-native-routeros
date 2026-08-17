/**
 * helpers/crud.ts — idempotent CRUD runner (plan 07-03).
 *
 * Owns the create→read(assert present)→update→read(assert stable id)→
 * delete→read(assert gone) scenario and the prefix sweep that removes any
 * leftover entities after a run (including on failure). Every created entity
 * carries a unique `<ROUTEROS_PREFIX>-<random4>` name so the sweep can find and
 * remove it without touching pre-existing router state (T-07-03).
 */
import { RouterOSAPI } from '../../../src/index';

/**
 * Per-version User Manager command-array recipe (see recipes/v6.ts,
 * recipes/v7.ts). Structural contract — both modules satisfy it.
 */
export interface UserManagerRecipe {
  /** Enable the User Manager package (may `!trap` on unlicensed devices). */
  enable: string[];
  profileAdd: (name: string) => string[];
  profileRead: () => string[];
  profileSet: (id: string, validity: string) => string[];
  profileDel: (id: string) => string[];
  userAdd: (name: string, password: string) => string[];
  userRead: () => string[];
  userSet: (id: string, password: string) => string[];
  userDel: (id: string) => string[];
  /** v7 `user-profile` link table; v6 is a throwing stub (no link table). */
  linkAdd: (user: string, profile: string) => string[];
  linkRead: () => string[];
  linkDel: (id: string) => string[];
  /** v7 NAS/RADIUS client; v6 is a throwing stub. */
  routerAdd: (name: string) => string[];
  routerRead: () => string[];
  routerDel: (id: string) => string[];
}

/** A recipe module: the command arrays + the user name field. */
export interface RecipeModule {
  userManager: UserManagerRecipe;
  /**
   * Field that carries the USER entity's name — v6 `username`, v7 `name`.
   * (Profiles use `name` on both; the sweep checks `name` AND `username`.)
   */
  fieldForName: 'name' | 'username';
}

/** Test prefix for all created entities — env-driven, defaults to `gsd-itest`. */
export function testPrefix(): string {
  return process.env.ROUTEROS_PREFIX || 'gsd-itest';
}

/** Build a unique entity name: `<prefix>-<random4>`. */
export function makeName(prefix?: string): string {
  const p = prefix || testPrefix();
  const random4 = Math.random().toString(36).slice(2, 6).padEnd(4, '0');
  return `${p}-${random4}`;
}

/** CRUD spec for a single entity kind. `set` is optional (link/router have no update). */
export interface CrudSpec {
  /** Build the add command words for a unique entity name. */
  add: (name: string) => string[];
  /** Build the read (print-all) command words. */
  read: () => string[];
  /** Build the update command words from the entity `.id` (optional). */
  set?: (id: string) => string[];
  /** Build the delete command words from the entity `.id`. */
  del: (id: string) => string[];
  /** Field carrying the entity name to match against. */
  fieldForName: string;
  /** Prefix used to build the unique entity name. */
  prefix: string;
}

/** Fetch all rows and return the row whose name field matches (undefined if absent). */
async function readByName(
  api: RouterOSAPI,
  read: () => string[],
  fieldForName: string,
  name: string
): Promise<Record<string, any> | undefined> {
  const rows = await api.write(read());
  return rows.find((row) => row[fieldForName] === name);
}

/**
 * Run create→read(assert present)→update(optional)→read(assert stable id)→
 * delete→read(assert gone) for a single entity. Uses fetch-all + client-side
 * filter (never `?name=` query words). On a failed step, `expect` throws and
 * the caller's `afterAll` `sweepByPrefix` removes the leftover entity.
 */
export async function runCrud(
  api: RouterOSAPI,
  recipe: RecipeModule,
  entityKind: string,
  spec: CrudSpec
): Promise<void> {
  const fieldForName = spec.fieldForName || recipe.fieldForName;
  const name = makeName(spec.prefix);

  // CREATE — recover `.id` from the add reply or the read-back.
  const addRows = await api.write(spec.add(name));
  let id: string | undefined = addRows[0]?.['.id'];

  // READ — assert present by unique name.
  const created = await readByName(api, spec.read, fieldForName, name);
  if (!id) {
    id = created?.['.id'];
  }
  expect(
    created,
    `${entityKind} '${name}' should be present after create`
  ).toBeDefined();
  expect(
    id,
    `${entityKind} '${name}' should carry a router-assigned .id`
  ).toBeDefined();

  // UPDATE — assert the set command succeeds and the entity persists (stable id).
  if (spec.set) {
    await api.write(spec.set(id as string));
    const updated = await readByName(api, spec.read, fieldForName, name);
    expect(
      updated,
      `${entityKind} '${name}' should persist after update`
    ).toBeDefined();
    expect(
      updated?.['.id'],
      `${entityKind} '${name}' .id should be stable across update`
    ).toBe(id);
  }

  // DELETE.
  await api.write(spec.del(id as string));

  // READ — assert gone.
  const gone = await readByName(api, spec.read, fieldForName, name);
  expect(gone, `${entityKind} '${name}' should be gone after delete`).toBeUndefined();
}

/**
 * Remove any entities whose `name`/`username` starts with `prefix`.
 * Idempotent and best-effort — safe to call from `afterAll`/`finally`.
 * Fetches all rows, filters client-side (never `?name=` query words), and
 * removes each match by `.id`.
 */
export async function sweepByPrefix(
  api: RouterOSAPI,
  recipe: RecipeModule,
  read: () => string[],
  del: (id: string) => string[],
  prefix: string
): Promise<void> {
  const rows = await api.write(read());
  for (const row of rows) {
    const candidate = row[recipe.fieldForName] ?? row.name ?? row.username;
    if (typeof candidate === 'string' && candidate.startsWith(prefix)) {
      const id = row['.id'];
      if (typeof id === 'string') {
        await api.write(del(id));
      }
    }
  }
}

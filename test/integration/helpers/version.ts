/**
 * RouterOS version detection helper (plan 07-01) + recipe selection (07-03).
 *
 * `detectVersion` reads `/system/resource/print` and derives the major
 * version (6 | 7) from the `.version` field. `selectRecipe` (added in 07-03)
 * lazily loads the matching per-version User Manager recipe module via a
 * dynamic import — keeping the recipe modules out of 07-01's compile graph so
 * 07-01 typechecked without a forward reference to 07-03's recipes.
 */
import { RouterOSAPI } from '../../../src/index';
import type { RecipeModule } from './crud';

export interface RouterVersion {
  /** Major version — 6 or 7 (anything not starting with 6 treated as 7). */
  major: 6 | 7;
  /** Full version string from the router (e.g. "6.49.10" / "7.14.2"). */
  full: string;
}

/**
 * Detect the RouterOS version of a connected API.
 *
 * @param api  A connected (logged-in) RouterOSAPI instance.
 * @returns    `{ major, full }` from `/system/resource/print`'s `.version`.
 */
export async function detectVersion(api: RouterOSAPI): Promise<RouterVersion> {
  const data = await api.write('/system/resource/print');
  const raw = data[0] && data[0].version;
  const full = typeof raw === 'string' ? raw : String(raw ?? 'unknown');
  const major: 6 | 7 = full.startsWith('6') ? 6 : 7;
  return { major, full };
}

/**
 * Select the per-version User Manager recipe for a connected API (07-03).
 *
 * @param api      A connected RouterOSAPI instance.
 * @param version  Optional pre-detected version — avoids a second
 *                 `/system/resource/print` probe when the caller already ran
 *                 `detectVersion()`.
 * @returns        the `recipes/v6` module for major 6, `recipes/v7` otherwise.
 */
export async function selectRecipe(
  api: RouterOSAPI,
  version?: RouterVersion
): Promise<RecipeModule> {
  const v = version ?? (await detectVersion(api));
  if (v.major === 6) {
    return import('../recipes/v6');
  }
  return import('../recipes/v7');
}

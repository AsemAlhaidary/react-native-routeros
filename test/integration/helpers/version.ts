/**
 * RouterOS version detection helper (plan 07-01).
 *
 * Reads `/system/resource/print` and derives the major version (6 | 7) from
 * the `.version` field. Only `detectVersion` lives here — `selectRecipe()`
 * is added in plan 07-03, which owns the recipe modules. Keeping it out of
 * 07-01 avoids a wave-1 `tsc --noEmit` failure from importing
 * `../recipes/v6` / `../recipes/v7` before they exist.
 */
import { RouterOSAPI } from '../../../src/index';

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

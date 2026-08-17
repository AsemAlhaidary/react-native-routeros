/**
 * Test-only stub for the `react-native` module.
 *
 * The library's RouterOSAPI (LIFE-01) imports `AppState` from 'react-native'
 * and registers a change listener. Under Node jest the real `react-native`
 * module cannot be loaded (native modules + ESM), so this stub satisfies the
 * import with a no-op subscription whose `.remove()` is a no-op.
 *
 * `AppStateStatus` is a type-only import in RouterOSAPI.ts, so it is not
 * needed here (erased at runtime).
 */
export const AppState = {
  addEventListener(_type: string, _cb: (state: string) => void) {
    return { remove() {} };
  },
};

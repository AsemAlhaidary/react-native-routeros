/**
 * Unit-test stub for the `react-native` module.
 *
 * RouterOSAPI (LIFE-01) imports `AppState` and registers a change listener.
 * Under Node jest the real module cannot load, so this stub satisfies the
 * import and additionally tracks the live listener count so unit tests can
 * assert the AppState subscription is removed on drop/close (F6).
 */
type AppStateListener = (state: string) => void;

const listeners = new Set<AppStateListener>();

export const AppState = {
  addEventListener(_type: string, cb: AppStateListener) {
    listeners.add(cb);
    return {
      remove() {
        listeners.delete(cb);
      },
    };
  },
  /** Test helper — number of live AppState change listeners. */
  __listenerCount(): number {
    return listeners.size;
  },
  /** Test helper — fire a state change to every live listener. */
  __emit(state: string): void {
    for (const l of listeners) l(state);
  },
  /** Test helper — drop all listeners between tests. */
  __reset(): void {
    listeners.clear();
  },
};

/**
 * Minimal type declarations for React Native AppState API.
 *
 * Only declares the subset used by RouterOSAPI (LIFE-01).
 * Full react-native types are available at runtime from the consumer's project.
 */
declare module 'react-native' {
  export type AppStateStatus = 'active' | 'background' | 'inactive' | 'unknown' | 'extension';

  export interface AppStateStatic {
    addEventListener(
      type: 'change',
      listener: (state: AppStateStatus) => void
    ): { remove: () => void };
  }

  export const AppState: AppStateStatic;
}

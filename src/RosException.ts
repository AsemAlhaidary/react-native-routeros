import messages from './messages';

/**
 * RouterOS Exception Handler — ported from node-routeros RosException.
 * Maps errno codes to human-readable messages from the static messages catalog.
 */
export class RosException extends Error {
  /** The errno key (e.g., 'CANTLOGIN', 'SOCKTMOUT') */
  public readonly errno: string;

  constructor(errno: string, extras?: Record<string, string>) {
    super();

    // Guard Error.captureStackTrace for non-V8 runtimes (Hermes, JSC)
    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, this.constructor);
    }

    // Use literal string for cross-runtime consistency (minifiers may rename classes)
    this.name = 'RosException';

    this.errno = errno;

    let message = messages[errno];

    if (message && extras) {
      for (const key in extras) {
        if (Object.prototype.hasOwnProperty.call(extras, key)) {
          // Global regex for correctness — original only replaced first occurrence
          message = message.replace(
            new RegExp('\\{\\{' + key + '\\}\\}', 'g'),
            extras[key]
          );
        }
      }
      this.message = message;
    } else if (message) {
      this.message = message;
    }
  }
}

import { RosException } from './RosException';

/**
 * Raised when RouterOS replies `!trap` to a write command.
 *
 * Unlike the base `RosException`, it carries the router's structured trap
 * attributes verbatim (`category`, `message`, `place`, `detail`) so consumers
 * can implement idempotent logic (e.g. `category === 0` → "already gone").
 *
 * Passes `instanceof Error`, `instanceof RosException`, and
 * `instanceof RosTrapException`.
 */
export class RosTrapException extends RosException {
  /** The verbatim `!trap` attributes from the router. */
  readonly trapAttributes: Record<string, string>;

  constructor(trapAttributes: Record<string, string>) {
    super('TRAP', { message: trapAttributes.message ?? 'RouterOS trap' });
    this.name = 'RosTrapException';
    this.trapAttributes = trapAttributes;
  }
}
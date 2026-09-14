import { RosCommandOptions, RosQueryWord } from './types';

/** camelCase → kebab-case: `limitUptime` → `limit-uptime`. */
function kebab(key: string): string {
  return key.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

/** One RouterOS query word from a `RosQueryWord`. */
function queryWord(q: RosQueryWord): string {
  switch (q.operator) {
    case '<':
      return `?${q.field}<${q.value ?? ''}`;
    case '>':
      return `?${q.field}>${q.value ?? ''}`;
    case '?':
      return `?${q.field}`; // presence — value ignored
    case '-':
      return `?-${q.field}`; // absence — the `-.field` negation
    case '=':
    default:
      return `?${q.field}=${q.value ?? ''}`;
  }
}

/**
 * Command word builder — the package-owned replacement for Wasl+'s
 * `CommandContext`. Builds `[path, ...=kebab=value, =.proplist=, ?query]`
 * words byte-identically to the app's today:
 *
 * - camelCase attribute keys → kebab-case
 * - `boolean` → `yes` / `no`
 * - `undefined` values skipped
 * - `''` values skipped unless `preserveEmptyValues`
 * - `-.field` query negation → `?-field`
 *
 * Never emits `.tag=` (the Channel owns it) and never emits the trailing
 * `''` terminator (Connector appends it).
 */
export class RosCommand {
  readonly path: string;
  readonly label: string;
  private readonly options: RosCommandOptions;

  constructor(path: string, options: RosCommandOptions = {}) {
    this.path = path;
    this.options = options;
    this.label = options.label ?? '';
  }

  toWords(): string[] {
    const words: string[] = [this.path];
    const { attributes, queries, proplist, preserveEmptyValues } = this.options;

    if (attributes) {
      for (const [key, value] of Object.entries(attributes)) {
        if (value === undefined) continue;
        if (value === '' && !preserveEmptyValues) continue;
        const encoded =
          typeof value === 'boolean'
            ? value
              ? 'yes'
              : 'no'
            : String(value);
        words.push(`=${kebab(key)}=${encoded}`);
      }
    }

    if (proplist && proplist.length > 0) {
      words.push(`=.proplist=${proplist.join(',')}`);
    }

    if (queries) {
      for (const q of queries) {
        words.push(queryWord(q));
      }
    }

    return words;
  }
}
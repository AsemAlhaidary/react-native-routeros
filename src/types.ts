/**
 * RN-adapted TLS options for react-native-tcp-socket.
 * Mirrors the react-native-tcp-socket TLS API (not Node's tls.TlsOptions).
 */
export interface TlsRnOptions {
  ca?: string | string[];
  key?: string;
  cert?: string;
  certAlias?: string;
  keyAlias?: string;
}

/**
 * Credential options needed for instantiating a RouterOSAPI object.
 * RN-adapted from node-routeros IRosOptions — uses TlsRnOptions instead of Node's TlsOptions.
 */
export interface IRosOptions {
  host: string;
  user?: string;
  password?: string;
  port?: number;
  timeout?: number;
  tls?: TlsRnOptions;
  keepalive?: boolean;
}

/**
 * Generic RouterOS API response shape — matches the original
 * node-routeros IRosGenericResponse byte-for-byte.
 */
export interface IRosGenericResponse {
  [propName: string]: any;
}

/**
 * Result of a `writeCommand()` call.
 * `records` is the resolved array (node-routeros parity), `ret` is the
 * `!done =ret=` value (the created object's `.id` on add flows), and `tag`
 * is the channel tag for correlation/debugging.
 */
export interface WriteResult {
  records: Record<string, string>[];
  ret?: string;
  tag: string;
}

/**
 * Per-command options for `writeCommand()` / `Channel.writeWithMeta()`.
 * `timeoutMs` rejects with `TIMEOUT` if the router never answers and cleans
 * up the receiver tag. `signal` aborts the command with `CANCELLED` and
 * sends `/cancel`.
 */
export interface WriteOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

/** One query condition: `?field=value`, `?field<value`, `?field>value`, `?field` (presence), `?-field` (absence). */
export interface RosQueryWord {
  field: string;
  operator: '=' | '<' | '>' | '?' | '-';
  value?: string;
}

/** Options for `RosCommand` — the app-facing word builder. */
export interface RosCommandOptions {
  /** CamelCase keys are converted to kebab-case; `true`/`false` → `yes`/`no`; `undefined` is skipped. */
  attributes?: Record<string, string | number | boolean | undefined>;
  queries?: RosQueryWord[];
  proplist?: string[];
  /** App correlation only — the package owns `.tag=`. */
  label?: string;
  timeoutMs?: number;
  /** Keep `''` attribute values on the wire instead of skipping them. */
  preserveEmptyValues?: boolean;
}

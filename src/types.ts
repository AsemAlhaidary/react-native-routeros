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

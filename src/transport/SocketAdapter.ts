import TcpSockets, { createConnection, connectTLS } from 'react-native-tcp-socket';
import { TlsRnOptions } from '../types';
import createDebug from 'debug';

const debug = createDebug('routeros-api:transport:socket-adapter');

/**
 * Normalized socket type that matches Node net.Socket API.
 * Both plain TCP and TLS sockets from react-native-tcp-socket
 * satisfy this interface post-creation.
 */
export type RosSocket = TcpSockets.Socket;

export interface CreateSocketOptions {
  host: string;
  port: number;
  timeout: number;         // seconds → converted to ms for connectTimeout
  tls?: TlsRnOptions;      // undefined = plain TCP
}

/**
 * Create a plain TCP socket (port 8728).
 * Mirrors original Connector.js non-TLS branch:
 *   new net.Socket() → socket.connect(port, host)
 */
export function createPlainSocket(options: CreateSocketOptions): RosSocket {
  debug('Creating plain TCP socket to %s:%d', options.host, options.port);
  const socket = createConnection(
    {
      port: options.port,
      host: options.host,
      connectTimeout: options.timeout * 1000,
    },
    () => {
      debug('Plain TCP connected to %s:%d', options.host, options.port);
    }
  );
  return socket;
}

/**
 * Create a TLS socket (port 8729).
 * Mirrors original Connector.js TLS branch:
 *   tls.connect(port, host, options, callback)
 *
 * TLS option mapping (RN-TCP vs Node tls.connect):
 *   - Node `rejectUnauthorized` → RN-TCP: no equivalent; always accepts if `ca` is provided
 *   - Node `ca` as string/Buffer → RN-TCP: `ca` as string (PEM content)
 *   - Node `key` as string/Buffer → RN-TCP: `key` as string (PEM content)
 *   - Node `cert` as string/Buffer → RN-TCP: `cert` as string (PEM content)
 *   - Node file paths → RN-TCP: consumer uses `require('./cert.pem')` (Metro-bundled)
 *
 * IMPORTANT: No `tlsClientError` event. TLS errors surface as regular 'error'
 * events on the socket. The Connector port removes the `tlsClientError` line.
 */
export function createTlsSocket(options: CreateSocketOptions): RosSocket {
  debug('Creating TLS socket to %s:%d', options.host, options.port);

  const tlsOpts: Record<string, any> = {
    port: options.port,
    host: options.host,
    connectTimeout: options.timeout * 1000,
  };

  // Map TlsRnOptions to RN-TCP TLS options
  if (options.tls) {
    if (options.tls.ca !== undefined) {
      tlsOpts.ca = options.tls.ca;
    }
    if (options.tls.key !== undefined) {
      tlsOpts.key = options.tls.key;
    }
    if (options.tls.cert !== undefined) {
      tlsOpts.cert = options.tls.cert;
    }
    // certAlias and keyAlias for Android keystore — pass through if provided
    if (options.tls.certAlias !== undefined) {
      tlsOpts.certAlias = options.tls.certAlias;
    }
    if (options.tls.keyAlias !== undefined) {
      tlsOpts.keyAlias = options.tls.keyAlias;
    }
  }

  const socket = connectTLS(tlsOpts, () => {
    debug('TLS connected to %s:%d', options.host, options.port);
  });

  return socket;
}

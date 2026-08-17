/**
 * Test-only bridge from `react-native-tcp-socket` → Node's built-in
 * `net`/`tls`.
 *
 * The library's `SocketAdapter` hardwires:
 *   TcpSockets.createConnection({ port, host, connectTimeout }, cb)
 *   TcpSockets.connectTLS(tlsOpts, cb)
 *
 * This shim satisfies those two call shapes using Node's real sockets, so the
 * library's unmodified protocol code (Receiver/Transmitter/Channel/login)
 * runs end-to-end against a live router from a desktop.
 *
 * IMPORTANT: `rejectUnauthorized: false` is injected for the lab self-signed
 * cert only — it is TEST SCOPE and is never shipped as library behavior.
 */
import * as net from 'net';
import * as tls from 'tls';

export interface BridgeOptions {
  host: string;
  port: number;
  [key: string]: unknown;
}

export default {
  // SocketAdapter.createPlainSocket() calls this
  createConnection(options: BridgeOptions, callback?: () => void) {
    return net.createConnection(
      { host: options.host, port: options.port },
      callback
    );
  },

  // SocketAdapter.createTlsSocket() calls this
  connectTLS(options: BridgeOptions, callback?: () => void) {
    // RouterOS API-SSL uses self-signed certs by default; react-native-tcp-socket
    // has no `rejectUnauthorized`, so the shim injects it for the lab case only.
    const { certAlias, keyAlias, ...rest } = options;
    return tls.connect(
      { ...rest, rejectUnauthorized: false } as tls.ConnectionOptions,
      callback
    );
  },
};

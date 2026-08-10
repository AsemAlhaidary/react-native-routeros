import { EventEmitter } from 'events';
import createDebug from 'debug';
import { createPlainSocket, createTlsSocket, RosSocket } from './transport/SocketAdapter';
import { Transmitter } from './Transmitter';
import { Receiver } from './Receiver';
import { RosException } from './RosException';
import { TlsRnOptions } from './types';

const debugInfo = createDebug('routeros-api:connector:connector:info');
const debugError = createDebug('routeros-api:connector:connector:error');

export interface ConnectorOptions {
  host: string;
  port?: number;
  timeout?: number;
  tls?: boolean | TlsRnOptions;
}

/**
 * Connector class responsible for communicating with
 * RouterOS via API, sending and receiving data.
 *
 * Owns the socket (via SocketAdapter), Transmitter, and Receiver.
 * Emits: 'connected', 'close', 'error', 'timeout'
 *
 * Ported from node-routeros Connector.js.
 * RN adaptations:
 *   - SocketAdapter replaces net/tls socket creation
 *   - tlsClientError event removed (RN-TCP surfaces as 'error')
 *   - 'end' event replaced with 'close' (RN-TCP has no 'end')
 */
export class Connector extends EventEmitter {
  private host: string;
  private port: number;
  private timeout: number;
  private tls?: TlsRnOptions;

  private connected = false;
  private connecting = false;
  private closing = false;

  private socket!: RosSocket;
  private transmitter!: Transmitter;
  private receiver!: Receiver;

  constructor(options: ConnectorOptions) {
    super();
    this.host = options.host;
    this.timeout = options.timeout ?? 10;     // default 10 seconds
    this.port = options.port ?? 8728;          // default port 8728 (plain TCP)

    // TLS handling — identical logic to original
    if (typeof options.tls === 'boolean' && options.tls) {
      this.tls = {}; // empty options = enable TLS with defaults
    }
    if (typeof options.tls === 'object') {
      if (!options.port) this.port = 8729;    // default TLS port
      this.tls = options.tls;
    }
  }

  /**
   * Connect to the RouterOS device.
   * Guarded by connected/connecting flags — prevents double-connect (PITFALLS.md #18).
   *
   * @returns this (for chaining)
   */
  connect(): this {
    if (!this.connected) {
      if (!this.connecting) {
        this.connecting = true;

        if (this.tls !== undefined) {
          // TLS connection (port 8729)
          this.socket = createTlsSocket({
            host: this.host,
            port: this.port,
            timeout: this.timeout,
            tls: this.tls,
          });
          this.transmitter = new Transmitter(this.socket);
          this.receiver = new Receiver(this.socket);
          // Wire events — NOTE: no tlsClientError (RN-TCP has none)
          this.socket.on('data', this.onData as any);
          this.socket.on('error', this.onError.bind(this));
          this.socket.once('close', () => this.onEnd());
          this.socket.once('timeout', this.onTimeout.bind(this));
          (this.socket as any).once('fatal', () => {
            this.onEnd('fatal');
          });
          this.socket.setTimeout(this.timeout * 1000);
          this.socket.setKeepAlive(true);
          // TLS connect callback fires from createTlsSocket factory
          this.onConnect();
        } else {
          // Plain TCP connection (port 8728)
          this.socket = createPlainSocket({
            host: this.host,
            port: this.port,
            timeout: this.timeout,
          });
          this.transmitter = new Transmitter(this.socket);
          this.receiver = new Receiver(this.socket);
          // Wire events
          this.socket.on('data', this.onData as any);
          this.socket.on('error', this.onError.bind(this));
          this.socket.once('close', () => this.onEnd());
          this.socket.once('timeout', this.onTimeout.bind(this));
          (this.socket as any).once('fatal', () => {
            this.onEnd('fatal');
          });
          this.socket.setTimeout(this.timeout * 1000);
          this.socket.setKeepAlive(true);
          // Plain TCP connect callback fires from createPlainSocket factory
          this.onConnect();
        }
      }
    }
    return this;
  }

  /**
   * Write data through the open socket.
   * Each array element is one RouterOS word. null terminator
   * is appended after all words to form a complete sentence.
   *
   * @param data  Array of strings (RouterOS words)
   * @returns this
   */
  write(data: string[]): this {
    for (const line of data) {
      this.transmitter.write(line);
    }
    this.transmitter.write(null); // sentence terminator
    return this;
  }

  /**
   * Register a tag to receive data callbacks from the Receiver.
   *
   * @param tag       Tag string (from Channel.id)
   * @param callback  Called with parsed packet lines
   */
  read(tag: string, callback: (packet: string[]) => void): void {
    this.receiver.read(tag, callback);
  }

  /**
   * Unregister a tag — stop waiting for data.
   *
   * @param tag  Tag string to remove
   */
  stopRead(tag: string): void {
    this.receiver.stop(tag);
  }

  /**
   * Gracefully close the connection.
   * Sends FIN via socket.end(), then onEnd() handles cleanup.
   */
  close(): void {
    if (!this.closing) {
      this.closing = true;
      this.socket.end();
    }
  }

  /**
   * Force-destroy the socket. No more data can be exchanged.
   * Removes all event listeners.
   */
  destroy(): void {
    this.socket.destroy();
    this.removeAllListeners();
  }

  // ──── Private event handlers ────

  /**
   * Connection established callback.
   * Resets connecting flag, flushes the transmitter pool,
   * and emits 'connected' to RouterOSAPI.
   */
  private onConnect(): void {
    this.connecting = false;
    this.connected = true;
    debugInfo('Connected on %s', this.host);
    this.transmitter.runPool();
    this.emit('connected', this);
  }

  /**
   * Socket close/fatal handler.
   * Emits 'close' with optional reason and destroys the socket + listeners.
   * @param reason  'fatal' for !fatal protocol errors, undefined for normal close
   */
  private onEnd(reason?: 'fatal'): void {
    this.emit('close', reason, this);
    this.destroy();
  }

  /**
   * Socket error handler.
   * Wraps the error in RosException (if not already) and emits 'error'.
   * Destroys the socket — errors are terminal for the connection.
   */
  private onError(err: Error & { errno?: string }): void {
    const rosErr = err instanceof RosException
      ? err
      : new RosException(err.errno || 'ECONNREFUSED', { message: err.message });
    debugError(
      'Problem while trying to connect to %s. Error: %s',
      this.host,
      rosErr.message
    );
    this.emit('error', rosErr, this);
    this.destroy();
  }

  /**
   * Socket timeout handler.
   * Emits SOCKTMOUT RosException and destroys the socket.
   */
  private onTimeout(): void {
    this.emit(
      'timeout',
      new RosException('SOCKTMOUT', { seconds: String(this.timeout) }),
      this
    );
    this.destroy();
  }

  /**
   * Socket data handler.
   * Forwards raw bytes to the Receiver for protocol parsing.
   */
  private onData(data: Uint8Array): void {
    debugInfo('Got data from the socket, will process it');
    this.receiver.processRawData(data);
  }
}

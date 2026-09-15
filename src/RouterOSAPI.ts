import { EventEmitter } from 'events';
import createDebug from 'debug';
import { AppState, AppStateStatus } from 'react-native';
import { Connector } from './Connector';
import { Channel } from './Channel';
import { RStream } from './RStream';
import { RosException } from './RosException';
import { md5Hash } from './md5';
import { IRosOptions, WriteOptions, WriteResult } from './types';

const debugInfo = createDebug('routeros-api:api:info');
const debugError = createDebug('routeros-api:api:error');

/**
 * RouterOSAPI — main public API for connecting to and
 * communicating with MikroTik RouterOS devices.
 *
 * Ported from node-routeros RouterOSAPI.js.
 * Phase 2: connect(), login(), setOptions(), close()
 * Phase 3: write(), writeStream(), stream(), keepaliveBy(), openChannel()
 */
export class RouterOSAPI extends EventEmitter {
  private host!: string;
  private user!: string;
  private password!: string;
  private port!: number;
  private timeout!: number;
  private tls?: IRosOptions['tls'];
  private keepalive!: boolean;

  private _connected = false;
  private _connecting = false;
  private closing = false;

  /** In-flight graceful-close promise — dedupes concurrent close() calls (F4). */
  private closePromise: Promise<this> | null = null;

  /** True when close() aborted a connect() that was still in flight. */
  private abortedByClose = false;

  /** Pending connect() reject function — lets close() settle a mid-handshake connect. */
  private pendingConnectReject: ((e: Error) => void) | null = null;

  private channelsOpen = 0;
  private holdingConnectionWithKeepalive = false;

  /** Active connection — null when disconnected */
  private connector: Connector | null = null;

  /** Timer handle for connection hold interval */
  private connectionHoldInterval: ReturnType<typeof setTimeout> | null = null;

  /** Timer handle for keepalive (Phase 3) */
  private keptaliveby: ReturnType<typeof setTimeout> | null = null;

  /** Registered RStream instances */
  private registeredStreams: RStream[] = [];

  /** React Native AppState listener subscription (LIFE-01) */
  private appStateSubscription: { remove: () => void } | null = null;

  constructor(options: IRosOptions) {
    super();
    this.setOptions(options);
  }

  /**
   * Socket-level connection truth: false while connecting, true after login,
   * false after close() and after an unexpected drop.
   */
  get connected(): boolean {
    return this._connected;
  }

  /** True while a connect() is in flight (including the login handshake). */
  get connecting(): boolean {
    return this._connecting;
  }

  /**
   * Set connection options. Can be called before connect()
   * or before reconnecting (CONN-05).
   */
  setOptions(options: IRosOptions): void {
    this.host = options.host;
    this.user = options.user || '';
    this.password = options.password || '';
    this.port = options.port || 8728;
    this.timeout = options.timeout || 10;
    this.tls = options.tls;
    this.keepalive = options.keepalive || false;
  }

  /**
   * Connect to the RouterOS device and authenticate.
   *
   * Flow:
   *   1. Create Connector with host/port/timeout/tls options
   *   2. Wait for Connector 'connected' event
   *   3. Execute login() — MD5 challenge-response
   *   4. On success: resolve Promise with this instance
   *   5. On error/timeout: reject Promise with RosException
   *
   * @returns Promise resolving to this RouterOSAPI instance
   */
  connect(): Promise<this> {
    if (this._connecting) {
      return Promise.reject(new RosException('ALRDYCONNECTING'));
    }
    if (this._connected) {
      return Promise.resolve(this);
    }

    debugInfo('Connecting on %s', this.host);
    this._connecting = true;
    this._connected = false;
    this.closePromise = null;
    this.abortedByClose = false;

    this.connector = new Connector({
      host: this.host,
      port: this.port,
      timeout: this.timeout,
      tls: this.tls,
      keepalive: this.keepalive,
    });

    return new Promise((resolve, reject) => {
      // Pre-login error listener — fires on connect failure, timeout, close.
      // The connect() promise must NEVER stay pending: endListener always
      // settles, mapping a pre-login close to CANCELLED (aborted by caller's
      // close()) or CLOSED (router/socket closed before login completed).
      const endListener = (e?: Error) => {
        this.stopAllStreams();
        this._connected = false;
        this._connecting = false;
        const rejectConnect = this.pendingConnectReject;
        this.pendingConnectReject = null;
        if (rejectConnect) {
          rejectConnect(
            e ? e : new RosException(this.abortedByClose ? 'CANCELLED' : 'CLOSED')
          );
        }
      };
      const preLoginClose = () => {
        this.emit('close');
        endListener();
      };

      this.pendingConnectReject = (e: Error) => reject(e);

      this.connector!.once('error', endListener);
      this.connector!.once('timeout', endListener);
      this.connector!.once('close', preLoginClose);

      this.connector!.once('connected', () => {
        this.login()
          .then(() => {
            this._connecting = false;
            this._connected = true;
            this.pendingConnectReject = null;

            // Register AppState listener for RN lifecycle awareness (LIFE-01)
            if (!this.appStateSubscription) {
              this.appStateSubscription = AppState.addEventListener(
                'change',
                (_nextAppState: AppStateStatus) => {
                  // On any state change, verify internal consistency.
                  // If connected flag is true but connector was destroyed
                  // (task-1 listener missed due to JS suspension), clean up.
                  if (this._connected && !this.connector) {
                    this._connected = false;
                    this.emit('close');
                  }
                }
              );
            }

            // Swap error/timeout/close listeners to post-login behavior
            this.connector!.removeListener('error', endListener);
            this.connector!.removeListener('timeout', endListener);
            this.connector!.removeListener('close', preLoginClose);

            // Post-login: persistent listeners for connection lifecycle.
            // 'close' fires for: !fatal, socket close, destroy — each exactly once
            // because Connector.destroy() → removeAllListeners().
            this.connector!.once('close', (reason?: 'fatal') => {
              this._connected = false;
              this._connecting = false;
              // Stop streams + clear timers + drop AppState listener
              // (mirrors close() cleanup — LIFE-01/F6: no leaked listener).
              this.stopAllStreams();
              this.clearConnectionTimers();
              this.removeAppStateListener();
              // Release connector reference
              this.connector = null;

              if (reason === 'fatal') {
                // ERR-02: Protocol-level !fatal — emit distinct event
                this.emit('fatal');
              }
              // LIFE-02: Consumer-facing close — enables reconnection
              this.emit('close');
            });

            // Post-login error — persistent (on, not once: multiple errors
            // can fire on a dying socket before destroy)
            this.connector!.on('error', (e: Error) => {
              this._connected = false;
              this._connecting = false;
              this.emit('error', e);
            });
            this.connector!.once('timeout', (e: Error) => {
              this._connected = false;
              this._connecting = false;
              this.emit('error', e);
            });

            // Start keepalive if configured (keeps session alive)
            if (this.keepalive) {
              this.keepaliveBy('#');
            }

            debugInfo('Logged in on %s', this.host);
            resolve(this);
          })
          .catch((e: Error) => {
            this._connecting = false;
            this._connected = false;
            this.pendingConnectReject = null;
            reject(e);
          });
      });

      // Initiate the actual TCP/TLS connection
      this.connector!.connect();
    });
  }

  /**
   * Close the connection gracefully.
   * Can be re-opened via setOptions() then connect() (CONN-05).
   *
   * Idempotent (F4): concurrent/second closes reuse the in-flight close
   * promise — never rejects `ALRDYCLOSNG`. Closing while connect() is in
   * flight aborts the handshake and settles connect() with `CANCELLED`.
   *
   * @returns Promise resolving when connection is fully closed
   */
  close(): Promise<this> {
    if (this.closePromise) {
      return this.closePromise;
    }

    // Abort an in-flight connect() (user cancelled mid-handshake).
    if (this._connecting) {
      this.abortedByClose = true;
      this.clearConnectionTimers();
      this.removeAppStateListener();
      this.stopAllStreams();
      const connector = this.connector;
      this.connector = null;
      if (connector) connector.destroy();
      const rejectConnect = this.pendingConnectReject;
      this.pendingConnectReject = null;
      if (rejectConnect) {
        rejectConnect(new RosException('CANCELLED'));
      }
      this._connecting = false;
      this._connected = false;
      return Promise.resolve(this);
    }

    if (!this._connected) {
      return Promise.resolve(this);
    }

    this.clearConnectionTimers();
    this.stopAllStreams();
    this.removeAppStateListener();

    const connector = this.connector!;
    this.closePromise = new Promise((resolve) => {
      this.closing = true;
      connector.once('close', () => {
        connector.destroy();
        this.connector = null;
        this.closing = false;
        this._connected = false;
        this.closePromise = null;
        resolve(this);
      });
      connector.close();
    });
    return this.closePromise;
  }

  /** Clear the connection-hold and keepalive timers (shared by close/drop). */
  private clearConnectionTimers(): void {
    if (this.connectionHoldInterval) {
      clearTimeout(this.connectionHoldInterval);
      this.connectionHoldInterval = null;
    }
    if (this.keptaliveby) {
      clearTimeout(this.keptaliveby);
      this.keptaliveby = null;
    }
  }

  /** Remove the AppState lifecycle listener (LIFE-01/F6 — no leaked listener). */
  private removeAppStateListener(): void {
    if (this.appStateSubscription) {
      this.appStateSubscription.remove();
      this.appStateSubscription = null;
    }
  }

  /**
   * Truthful connection drop: clear timers/streams, flip the connected state
   * to false, release the connector, and emit 'close' exactly once. Used when
   * a keepalive probe fails — the transport is gone, so reporting `connected`
   * would be a lie (the app relies on this signal to reconnect).
   */
  private handleConnectionLost(): void {
    if (this.closing || (!this._connected && !this.connector)) return; // explicit close or already handled
    this.clearConnectionTimers();
    this.stopAllStreams();
    this.removeAppStateListener();
    const connector = this.connector;
    this.connector = null;
    this._connected = false;
    this._connecting = false;
    if (connector) connector.destroy();
    this.emit('close');
  }

  /**
   * Open a new tagged channel for a command.
   * Used internally by write() / writeCommand() / writeStream() / stream().
   *
   * F7: single choke point — throws a typed `NOTCONNECTED` instead of the
   * untyped `TypeError` that `new Channel(this.connector!)` produced after a
   * drop (connector is null). write()/writeCommand() catch this and return a
   * rejected promise; stream paths throw synchronously.
   */
  openChannel(): Channel {
    if (!this.connector || this.closing) {
      throw new RosException('NOTCONNECTED');
    }
    this.increaseChannelsOpen();
    return new Channel(this.connector);
  }

  // ──── Private methods ────

  /**
   * Authenticate with RouterOS using MD5 challenge-response.
   *
   * RouterOS v6.43+ login flow:
   *   1. Send /login with name and password directly
   *   2. If response length === 0 → credentials accepted (fast path)
   *   3. If response length === 1 with 'ret' field → challenge received
   *      - Build challenge buffer: [0x00] + password bytes + challenge hex bytes
   *      - MD5 hash the buffer → '00' + lowercase hex digest
   *      - Send /login with name and response
   *   4. If login fails with known messages → CANTLOGIN
   *
   * PITFALLS.md #2: MD5 challenge must operate on raw bytes, not strings.
   * The challenge buffer is: 0x00 + password (Latin-1 bytes) + challenge (hex-decoded to 16 bytes).
   */
  private login(): Promise<this> {
    this._connecting = true;
    debugInfo('Sending 6.43+ login to %s', this.host);

    // Step 1: Send initial login with plain password
    // Uses openChannel() + Channel.write() for the command
    return this.write('/login', [
      `=name=${this.user}`,
      `=password=${this.password}`,
    ])
      .then((data) => {
        if (data.length === 0) {
          // Fast path — RouterOS v6.43+ accepted credentials directly
          debugInfo(
            '6.43+ Credentials accepted on %s, we are connected',
            this.host
          );
          return Promise.resolve(this);
        } else if (data.length === 1) {
          // Challenge received — construct MD5 response
          debugInfo(
            'Received challenge on %s, will send credentials. Data: %o',
            this.host,
            data
          );

          const challengeHex: string = (data[0] as any).ret;
          if (!challengeHex || challengeHex.length !== 32) {
            return Promise.reject(
              new RosException('CANTLOGIN', {
                message: 'Invalid challenge received from router',
              })
            );
          }

          // Build the challenge buffer:
          // Layout: [0x00][password bytes][16 bytes of challenge]
          const passwordBytes = this.encodeLatin1(this.password);
          const challengeBytes = this.hexToBytes(challengeHex);

          const challenge = new Uint8Array(
            1 + passwordBytes.length + challengeBytes.length
          );
          challenge[0] = 0x00; // null byte
          challenge.set(passwordBytes, 1);
          challenge.set(challengeBytes, 1 + passwordBytes.length);

          // MD5 hash (Phase 1 md5Hash accepts Uint8Array)
          const resp = '00' + md5Hash(challenge);

          // Step 3: Send response login
          return this.write('/login', [
            '=name=' + this.user,
            '=response=' + resp,
          ])
            .then(() => {
              debugInfo(
                'Credentials accepted on %s, we are connected',
                this.host
              );
              return Promise.resolve(this);
            })
            .catch((err) => {
              if (
                err.message === 'cannot log in' ||
                err.message === 'invalid user name or password (6)'
              ) {
                err = new RosException('CANTLOGIN');
              }
              this.connector!.destroy();
              debugError(
                "Couldn't log in to %s, Error: %O",
                this.host,
                err
              );
              return Promise.reject(err);
            });
        }

        // Unknown response from /login
        debugError(
          'Unknown return from /login command on %s, data returned: %O',
          this.host,
          data
        );
        return Promise.reject(new RosException('CANTLOGIN'));
      })
      .catch((err) => {
        if (
          err.message === 'cannot log in' ||
          err.message === 'invalid user name or password (6)'
        ) {
          err = new RosException('CANTLOGIN');
        }
        if (this.connector) {
          this.connector.destroy();
        }
        debugError("Couldn't log in to %s, Error: %O", this.host, err);
        return Promise.reject(err);
      });
  }

  /**
   * Writes a command over the socket to the routerboard
   * on a new channel.
   *
   * @param params       Command path (string) or full params array
   * @param moreParams   Additional parameters (spread)
   * @returns            Promise resolving with parsed response data on !done,
   *                     rejecting with a plain Error (trap message) on !trap
   */
  write(
    params: string | string[],
    ...moreParams: (string | string[])[]
  ): Promise<Record<string, any>[]> {
    params = this.concatParams(params, moreParams);
    let chann: Channel | null;
    try {
      chann = this.openChannel();
    } catch (e) {
      // F7 — never throw synchronously; reject with a typed error instead.
      return Promise.reject(e);
    }
    this.holdConnection();

    chann.once('close', () => {
      chann = null; // GC hint (matches original)
      this.decreaseChannelsOpen();
      this.releaseConnectionHold();
    });

    return chann.write(params) as Promise<Record<string, any>[]>;
  }

  /**
   * Write a command and resolve with records + `ret` + `tag`.
   *
   * This is the primary API for Wasl+; `write()` stays for node-routeros
   * parity. Builds words `[path, ...params]` (flat; empty strings like
   * `=comment=` preserved; no `.tag=`, no terminator — Channel appends both).
   */
  writeCommand(
    path: string,
    params: string[] = [],
    opts: WriteOptions = {}
  ): Promise<WriteResult> {
    let chann: Channel;
    try {
      chann = this.openChannel();
    } catch (e) {
      return Promise.reject(e);
    }
    this.holdConnection();

    chann.once('close', () => {
      this.decreaseChannelsOpen();
      this.releaseConnectionHold();
    });

    return chann
      .writeWithMeta([path, ...params], opts)
      .then((r) => ({
        records: r.records as Record<string, string>[],
        ret: r.ret,
        tag: chann.Id,
      }));
  }

  /**
   * Writes a command over the socket to the routerboard
   * on a new channel and returns an RStream that emits
   * 'data', 'done', 'trap', and 'close' events.
   *
   * @param params       Command path (string) or full params array
   * @param moreParams   Additional parameters (spread)
   * @returns            RStream — listen to 'data' for each sentence
   */
  writeStream(
    params: string | string[],
    ...moreParams: (string | string[])[]
  ): RStream {
    params = this.concatParams(params, moreParams);
    const stream = new RStream(this.openChannel(), params as string[]);

    stream.on('started', () => {
      this.holdConnection();
    });
    stream.on('stopped', () => {
      this.unregisterStream(stream);
      this.decreaseChannelsOpen();
      this.releaseConnectionHold();
    });

    stream.start();
    this.registerStream(stream);
    return stream;
  }

  /**
   * Returns a stream object for handling continuous data
   * flow. Used for endpoints like /tool/torch that
   * keep sending data endlessly.
   *
   * @param params       Command path or params array
   * @param moreParams   Additional params + optional callback as last arg
   * @returns            RStream with empty-data debouncing enabled
   */
  stream(
    params: string | string[] = [],
    ...moreParams: (string | string[] | ((err: Error | null, packet?: any, stream?: RStream) => void))[]
  ): RStream {
    let callback = moreParams.pop() as
      | ((err: Error | null, packet?: any, stream?: RStream) => void)
      | undefined;

    if (typeof callback !== 'function') {
      if (callback) {
        moreParams.push(callback as any);
      }
      callback = undefined;
    }

    params = this.concatParams(
      params,
      moreParams as (string | string[])[]
    );

    const stream = new RStream(
      this.openChannel(),
      params as string[],
      callback
    );

    stream.on('started', () => {
      this.holdConnection();
    });
    stream.on('stopped', () => {
      this.unregisterStream(stream);
      this.decreaseChannelsOpen();
      this.releaseConnectionHold();
    });

    stream.start();
    stream.prepareDebounceEmptyData();
    this.registerStream(stream);
    return stream;
  }

  /**
   * Concatenate parameters into a flat string array.
   * Handles both string and array arguments (variadic).
   */
  concatParams(
    firstParameter: string | string[],
    parameters: (string | string[])[]
  ): string[] {
    if (typeof firstParameter === 'string') {
      firstParameter = [firstParameter];
    }
    for (let parameter of parameters) {
      if (typeof parameter === 'string') {
        parameter = [parameter];
      }
      if (parameter.length > 0) {
        firstParameter = firstParameter.concat(parameter);
      }
    }
    return firstParameter;
  }

  // ──── Channel bookkeeping (verbatim from original) ────

  private increaseChannelsOpen(): void {
    this.channelsOpen++;
  }

  private decreaseChannelsOpen(): void {
    this.channelsOpen--;
  }

  private registerStream(stream: RStream): void {
    this.registeredStreams.push(stream);
  }

  private unregisterStream(stream: RStream): void {
    this.registeredStreams = this.registeredStreams.filter(
      (s) => s !== stream
    );
  }

  private stopAllStreams(): void {
    for (const stream of this.registeredStreams) {
      stream.stop();
    }
  }

  // ──── Connection hold (verbatim from original) ────

  /**
   * Hold the connection open while channels are active.
   * Sends a dummy '#' command at (timeout / 2) intervals to
   * prevent RouterOS from timing out the session.
   */
  private holdConnection(): void {
    if (this.channelsOpen !== 1) return;
    if (this._connected && !this.holdingConnectionWithKeepalive) {
      if (this.connectionHoldInterval) {
        clearTimeout(this.connectionHoldInterval);
      }
      const holdConnInterval = () => {
        this.connectionHoldInterval = setTimeout(() => {
          let chann: Channel | null = new Channel(this.connector!);
          chann.on('close', () => {
            chann = null;
          });
          (chann.write(['#']) as Promise<Record<string, any>[]>)
            .then(() => {
              holdConnInterval();
            })
            .catch(() => {
              holdConnInterval();
            });
        }, (this.timeout * 1000) / 2);
      };
      holdConnInterval();
    }
  }

  private releaseConnectionHold(): void {
    if (this.channelsOpen > 0) return;
    if (this.connectionHoldInterval) {
      clearTimeout(this.connectionHoldInterval);
      this.connectionHoldInterval = null;
    }
  }

  // ──── Keepalive (stub for Phase 3; enough for connect()) ────

  /**
   * Keep the connection alive by running a set of
   * commands provided instead of the random command.
   *
   * Sends the command every (timeout / 2) seconds.
   * Continues across channel open/close cycles.
   *
   * @param params       Command string or array to send as keepalive
   * @param moreParams   Additional params + optional callback as last arg
   */
  keepaliveBy(
    params: string | string[] = '#',
    ...moreParams: (
      | string
      | string[]
      | ((err: Error | null, data?: any) => void)
    )[]
  ): void {
    this.holdingConnectionWithKeepalive = true;

    if (this.keptaliveby) {
      clearTimeout(this.keptaliveby);
    }

    let callback = moreParams.pop() as
      | ((err: Error | null, data?: any) => void)
      | undefined;

    if (typeof callback !== 'function') {
      if (callback) {
        moreParams.push(callback as any);
      }
      callback = undefined;
    }

    params = this.concatParams(
      params,
      moreParams as (string | string[])[]
    );

    const exec = () => {
      if (!this.closing) {
        if (this.keptaliveby) {
          clearTimeout(this.keptaliveby);
        }
        this.keptaliveby = setTimeout(() => {
          // Bound the probe: a half-open socket can leave a bare write() pending
          // forever (no '!done', no socket error), which would report `connected`
          // while the router is gone. `timeoutMs` rejects with TIMEOUT → drop.
          const path = params[0] ?? '#';
          (this.writeCommand(path, params.slice(1), {
            timeoutMs: this.timeout * 1000,
          }) as Promise<{ records: Record<string, any>[] }>)
            .then((r) => {
              if (typeof callback === 'function') {
                callback(null, r.records);
              }
              exec();
            })
            .catch((err) => {
              if (typeof callback === 'function') {
                callback(err, null);
              }
              // A '#' probe must succeed near-instantly. Any failure (including
              // the timeout above) means the transport is gone — report it
              // truthfully and stop the loop instead of rescheduling forever
              // while `connected` still reads true.
              this.handleConnectionLost();
            });
        }, (this.timeout * 1000) / 2);
      }
    };

    exec();
  }

  // ──── Encoding helpers for MD5 challenge ────

  /**
   * Encode a string to Latin-1 (ISO 8859-1) bytes.
   * RouterOS passwords in the MD5 challenge use Latin-1, not UTF-8.
   * This matches the original Buffer.write(String.fromCharCode(0) + password)
   * behavior — Buffer.write with no encoding defaults to Latin-1.
   *
   * PITFALLS.md #2: Using UTF-8 for password bytes produces wrong MD5 hash.
   */
  private encodeLatin1(str: string): Uint8Array {
    const bytes = new Uint8Array(str.length);
    for (let i = 0; i < str.length; i++) {
      bytes[i] = str.charCodeAt(i) & 0xff; // Latin-1: truncate to byte
    }
    return bytes;
  }

  /**
   * Convert a hex string (32 chars = 16 bytes) to Uint8Array.
   * Used to decode the challenge 'ret' value from RouterOS.
   */
  private hexToBytes(hex: string): Uint8Array {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
    }
    return bytes;
  }
}

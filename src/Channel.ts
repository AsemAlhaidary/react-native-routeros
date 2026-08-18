import { EventEmitter } from 'events';
import createDebug from 'debug';
import { RosException } from './RosException';
import { Connector } from './Connector';

const debugInfo = createDebug('routeros-api:channel:info');
const debugError = createDebug('routeros-api:channel:error');

/**
 * Channel class — generates unique IDs for commands and manages
 * the request/response lifecycle for a single RouterOS API command.
 *
 * Ported verbatim from node-routeros Channel.js.
 */
export class Channel extends EventEmitter {
  /** Accumulated !re data sentences received for this channel */
  private data: Record<string, any>[] = [];

  /** Whether a !trap was received (prevents !done from resolving) */
  private trapped = false;

  /** Whether this channel is for a streaming command */
  private streaming = false;

  /** Unique tag ID for this channel */
  private id: string;

  /** Reference to the parent Connector */
  private connector: Connector;

  constructor(connector: Connector) {
    super();
    // Generate a random tag — matches original Math.random().toString(36).substring(3)
    this.id = Math.random().toString(36).substring(3);
    this.connector = connector;
    // Catch unexpected reply types
    this.once('unknown', this.onUnknown.bind(this));
  }

  /** Public getter for the channel's tag ID */
  get Id(): string {
    return this.id;
  }

  /** Public getter for the parent connector */
  get Connector(): Connector {
    return this.connector;
  }

  /**
   * Write a command to RouterOS over this channel.
   *
   * Appends `.tag=<this.id>` to the params so RouterOS routes
   * the response back to this channel's reader.
   *
   * @param params         Array of RouterOS command words (e.g., ['/login', '=name=admin'])
   * @param isStream       Whether this is a streaming command (default false)
   * @param returnPromise  Whether to return a Promise (default true). false for fire-and-forget.
   * @returns              Promise resolving on !done, rejecting on !trap
   */
  write(
    params: string[],
    isStream: boolean = false,
    returnPromise: boolean | undefined = true
  ): Promise<Record<string, any>[]> | void {
    this.streaming = isStream;

    // Append the channel's tag to the command parameters
    params.push('.tag=' + this.id);

    if (returnPromise) {
      // Collect !re data sentences as they arrive
      this.on('data', (packet: Record<string, any>) => this.data.push(packet));

      return new Promise<Record<string, any>[]>((resolve, reject) => {
        this.once('done', (data) => resolve(data));
        this.once('trap', (data) =>
          reject(new Error(data.message))
        );
        this.readAndWrite(params);
      });
    }

    // Fire-and-forget (used internally by RStream in Phase 3)
    this.readAndWrite(params);
    return;
  }

  /**
   * Close the channel and remove its tag reader from the Connector.
   *
   * @param force  If true, removes ALL listeners. If false (default),
   *               only removes the reader; streaming channels keep listeners alive.
   */
  close(force: boolean = false): void {
    this.emit('close');
    if (!this.streaming || force) {
      this.removeAllListeners();
    }
    this.connector.stopRead(this.id);
  }

  /**
   * Register the tag reader on the Connector and write the command.
   * Called after event listeners are set up in write().
   */
  private readAndWrite(params: string[]): void {
    this.connector.read(this.id, (packet) => this.processPacket(packet));
    this.connector.write(params);
  }

  /**
   * Process a response packet received from RouterOS for this channel.
   *
   * Parses the packet, then routes based on the reply type:
   *   !done  → emit 'done' with accumulated data (resolves the Promise)
   *   !trap  → emit 'trap' with parsed error data (rejects the Promise)
   *   !re    → emit 'data' (non-streaming) or 'stream' (streaming)
   *   !empty → emit 'unknown' (existing behavior; upgraded in Phase 4)
   *   other  → emit 'unknown' and close
   *
   * @param packet  Array of raw response lines from the Receiver
   */
  private processPacket(packet: string[]): void {
    const reply = packet.shift()!;
    debugInfo('Processing reply %s with data %o', reply, packet);

    const parsed = this.parsePacket(packet);

    if (reply === '!trap') {
      this.trapped = true;
      this.emit('trap', parsed);
      return;
    }

    // Non-streaming mode: emit 'data' for !re lines (accumulated by write())
    if (packet.length > 0 && !this.streaming) {
      this.emit('data', parsed);
    }

    switch (reply) {
      case '!re':
        // Streaming mode: emit 'stream' for RStream consumption
        if (this.streaming) {
          this.emit('stream', parsed);
        }
        break;
      case '!done':
        // If !trap was received earlier, don't emit 'done'
        if (!this.trapped) {
          this.emit('done', this.data);
        }
        this.close();
        break;
      case '!empty':
        // RouterOS v7.18+ sends !empty when a command succeeds but matches no
        // records. Treat it as a successful completion with no data rows
        // (write() resolves to an empty array) rather than an unknown reply.
        if (!this.trapped) {
          this.emit('done', this.data);
        }
        this.close();
        break;
      default:
        // Unknown reply type — emit 'unknown' which triggers RosException
        this.emit('unknown', reply);
        this.close();
        break;
    }
  }

  /**
   * Parse a raw RouterOS response packet into a key-value object.
   *
   * RouterOS format: ['=interface=ether2', '=status=up']
   * Parsed:          { interface: 'ether2', status: 'up' }
   *
   * @param packet  Array of raw response lines
   * @returns       Parsed key-value object
   */
  private parsePacket(packet: string[]): Record<string, any> {
    const obj: Record<string, any> = {};
    for (const line of packet) {
      const linePair = line.split('=');
      linePair.shift(); // remove leading empty string (line starts with '=')
      const key = linePair.shift();
      if (key) {
        obj[key] = linePair.join('='); // rejoin in case value contains '='
      }
    }
    debugInfo('Parsed line, got %o as result', obj);
    return obj;
  }

  /**
   * Handle unexpected reply types.
   * Throws RosException — this should never happen in normal operation.
   */
  private onUnknown(reply: string): void {
    throw new RosException('UNKNOWNREPLY', { reply });
  }
}

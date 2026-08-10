import createDebug from 'debug';
import { encodeWin1252 } from './win1252';
import { RosSocket } from './transport/SocketAdapter';

const debug = createDebug('routeros-api:connector:transmitter');

/**
 * Class responsible for transmitting data over the
 * socket to the RouterOS device.
 *
 * Ported verbatim from node-routeros Transmitter.js.
 * Only change: iconv.encode(str, 'win1252') → encodeWin1252(str).
 */
export class Transmitter {
  /**
   * Pool of pre-encoded data frames to be sent after the socket connects.
   * When the socket is not yet writable, frames are queued here and
   * flushed by runPool() when the connection is established.
   */
  private pool: Uint8Array[] = [];

  private socket: RosSocket;

  constructor(socket: RosSocket) {
    this.socket = socket;
  }

  /**
   * Write data over the socket. If the socket is not writable yet
   * (or there are items queued in the pool), save to pool for later
   * flush via runPool().
   *
   * @param data  String to encode, or null for end-of-sentence marker (0x00 byte)
   */
  write(data: string | null): void {
    const encodedData = this.encodeString(data);
    if (!(this.socket as any).writable || this.pool.length > 0) {
      debug('Socket not writable, saving %o in the pool', data);
      this.pool.push(encodedData);
    } else {
      debug('Writing command %s over the socket', data);
      this.socket.write(encodedData);
    }
  }

  /**
   * Flush all data frames stored in the pool.
   * Called by Connector.onConnect() after the socket connection is established.
   *
   * Uses FIFO order — frames are written in the order they were queued.
   */
  runPool(): void {
    debug('Running stacked command pool');
    let data: Uint8Array | undefined;
    while (this.pool.length > 0) {
      data = this.pool.shift();
      if (data) {
        this.socket.write(data);
      }
    }
  }

  /**
   * Encode a string (or null terminator) into a RouterOS length-prefixed frame.
   *
   * RouterOS word encoding (from the API protocol spec):
   * - Length < 0x80        → 1 byte: [len]
   * - Length < 0x4000      → 2 bytes: [len|0x8000] (big-endian)
   * - Length < 0x200000    → 3 bytes: [len|0xC00000]
   * - Length < 0x10000000  → 4 bytes: [len|0xE0000000]
   * - Length >= 0x10000000 → 5 bytes: [0xF0][len as 4 byte big-endian]
   *
   * null input → sentence terminator: single 0x00 byte.
   *
   * @param str  Content string to encode (win1252), or null for terminator.
   * @returns    Uint8Array containing length prefix + encoded content.
   */
  private encodeString(str: string | null): Uint8Array {
    // Sentence terminator
    if (str === null) {
      return new Uint8Array([0x00]);
    }

    // Encode content to win1252 bytes using Phase 1 codec
    const encoded = encodeWin1252(str);
    const len = encoded.length;
    let result: Uint8Array;
    let offset = 0;

    if (len < 0x80) {
      // 1-byte length prefix
      result = new Uint8Array(len + 1);
      result[offset++] = len;
    } else if (len < 0x4000) {
      // 2-byte length prefix (0x8000 flag)
      result = new Uint8Array(len + 2);
      const marked = len | 0x8000;
      result[offset++] = (marked >> 8) & 0xff;
      result[offset++] = marked & 0xff;
    } else if (len < 0x200000) {
      // 3-byte length prefix (0xC00000 flag)
      result = new Uint8Array(len + 3);
      const marked = len | 0xc00000;
      result[offset++] = (marked >> 16) & 0xff;
      result[offset++] = (marked >> 8) & 0xff;
      result[offset++] = marked & 0xff;
    } else if (len < 0x10000000) {
      // 4-byte length prefix (0xE0000000 flag)
      result = new Uint8Array(len + 4);
      const marked = len | 0xe0000000;
      result[offset++] = (marked >> 24) & 0xff;
      result[offset++] = (marked >> 16) & 0xff;
      result[offset++] = (marked >> 8) & 0xff;
      result[offset++] = marked & 0xff;
    } else {
      // 5-byte length prefix (0xF0 followed by 4-byte big-endian)
      result = new Uint8Array(len + 5);
      result[offset++] = 0xf0;
      result[offset++] = (len >> 24) & 0xff;
      result[offset++] = (len >> 16) & 0xff;
      result[offset++] = (len >> 8) & 0xff;
      result[offset++] = len & 0xff;
    }

    // Copy encoded content after the length prefix
    result.set(encoded, offset);
    return result;
  }
}

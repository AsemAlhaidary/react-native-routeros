/**
 * Unit-test FakeSocket for `react-native-tcp-socket`.
 *
 * The library's `SocketAdapter` hardwires:
 *   TcpSockets.createConnection({...}, cb)
 *   TcpSockets.connectTLS({...}, cb)
 *
 * This mock returns a scriptable EventEmitter socket instead of a real one, so
 * unit tests can drive the protocol deterministically: capture written frames,
 * inject `data`/`error`/`close`/`timeout` events, and inspect the byte stream.
 *
 * Byte helpers reuse the production win1252 codec so framing matches the wire.
 */
import { EventEmitter } from 'events';
import { encodeWin1252, decodeWin1252 } from '../../../src/win1252';

/** Encode one RouterOS word (length prefix + win1252 content); null → 0x00 terminator. */
export function encodeWord(word: string | null): Uint8Array {
  if (word === null) return new Uint8Array([0x00]);
  const content = encodeWin1252(word);
  const len = content.length;
  let prefix: number[];
  if (len < 0x80) {
    prefix = [len];
  } else if (len < 0x4000) {
    const m = len | 0x8000;
    prefix = [(m >> 8) & 0xff, m & 0xff];
  } else if (len < 0x200000) {
    const m = len | 0xc00000;
    prefix = [(m >> 16) & 0xff, (m >> 8) & 0xff, m & 0xff];
  } else {
    throw new Error('test encoder: word too long');
  }
  const out = new Uint8Array(prefix.length + len);
  out.set(prefix, 0);
  out.set(content, prefix.length);
  return out;
}

/** Encode a full sentence: words + 0x00 terminator. */
export function encodeSentence(words: string[]): Uint8Array {
  const frames = words.map((w) => encodeWord(w));
  frames.push(encodeWord(null));
  let total = 0;
  for (const f of frames) total += f.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const f of frames) {
    out.set(f, off);
    off += f.length;
  }
  return out;
}

/** Decode a list of captured frames into words (null = sentence terminator). */
export function decodeFrames(frames: Uint8Array[]): (string | null)[] {
  const out: (string | null)[] = [];
  for (const frame of frames) {
    let i = 0;
    while (i < frame.length) {
      const b = frame[i];
      if (b === 0x00) {
        out.push(null);
        i += 1;
        continue;
      }
      let len: number;
      let consumed: number;
      if (!(b & 0x80)) {
        len = b;
        consumed = 1;
      } else if ((b & 0xc0) === 0x80) {
        len = ((b & 0x3f) << 8) | frame[i + 1];
        consumed = 2;
      } else if ((b & 0xe0) === 0xc0) {
        len = ((b & 0x1f) << 16) | (frame[i + 1] << 8) | frame[i + 2];
        consumed = 3;
      } else if ((b & 0xf0) === 0xe0) {
        len =
          ((b & 0x0f) << 24) |
          (frame[i + 1] << 16) |
          (frame[i + 2] << 8) |
          frame[i + 3];
        consumed = 4;
      } else {
        len =
          (frame[i + 1] << 24) |
          (frame[i + 2] << 16) |
          (frame[i + 3] << 8) |
          frame[i + 4];
        consumed = 5;
      }
      out.push(decodeWin1252(frame.slice(i + consumed, i + consumed + len)));
      i += consumed + len;
    }
  }
  return out;
}

/** Group decoded words into sentences (split on null terminators). */
export function toSentences(words: (string | null)[]): string[][] {
  const sentences: string[][] = [];
  let cur: string[] = [];
  for (const w of words) {
    if (w === null) {
      if (cur.length) {
        sentences.push(cur);
        cur = [];
      }
    } else {
      cur.push(w);
    }
  }
  if (cur.length) sentences.push(cur);
  return sentences;
}

export class FakeSocket extends EventEmitter {
  writable = true;
  destroyed = false;
  readonly frames: Uint8Array[] = [];

  write(data: Uint8Array): boolean {
    this.frames.push(data);
    return true;
  }

  setTimeout(_ms: number): this {
    return this;
  }

  setKeepAlive(_enable: boolean): this {
    return this;
  }

  end(): this {
    this.emit('close');
    return this;
  }

  destroy(): this {
    this.destroyed = true;
    return this;
  }

  emitData(data: Uint8Array): void {
    this.emit('data', data);
  }

  emitError(e: Error): void {
    this.emit('error', e);
  }

  emitClose(): void {
    this.emit('close');
  }

  emitTimeout(): void {
    this.emit('timeout');
  }

  /** All written sentences (words split on terminators). */
  sentences(): string[][] {
    return toSentences(decodeFrames(this.frames));
  }

  clearFrames(): void {
    this.frames.length = 0;
  }
}

let sockets: FakeSocket[] = [];

function makeSocket(): FakeSocket {
  const s = new FakeSocket();
  sockets.push(s);
  return s;
}

/**
 * Create a FakeSocket that emits 'connect' on the next tick, mirroring the
 * real socket (which connects asynchronously). Consumers attach their
 * 'connect' listeners synchronously after createConnection() returns, so the
 * deferred emit is what lets Connector.onConnect()/login run in unit tests.
 */
function makeConnectedSocket(cb?: () => void): FakeSocket {
  const s = makeSocket();
  setImmediate(() => {
    s.emit('connect');
    if (cb) cb();
  });
  return s;
}

/** The most recently created FakeSocket (the active connection). */
export function lastSocket(): FakeSocket {
  if (sockets.length === 0) {
    throw new Error('FakeSocket: no socket created yet');
  }
  return sockets[sockets.length - 1];
}

/** Drop the socket registry between tests. */
export function resetSockets(): void {
  sockets = [];
}

export default {
  createConnection(_opts: unknown, cb?: () => void): FakeSocket {
    return makeConnectedSocket(cb);
  },
  connectTLS(_opts: unknown, cb?: () => void): FakeSocket {
    return makeConnectedSocket(cb);
  },
};

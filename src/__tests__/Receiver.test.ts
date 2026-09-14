import { EventEmitter } from 'events';
import { Receiver } from '../Receiver';
import {
  encodeSentence,
  encodeWord,
} from '../../test/unit/mocks/react-native-tcp-socket';

function makeReceiver() {
  const socket = new EventEmitter();
  const receiver = new Receiver(socket as any);
  return { socket, receiver };
}

/** Concatenate frames into one byte buffer. */
function concat(frames: Uint8Array[]): Uint8Array {
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

describe('Receiver framing', () => {
  test('decodeLength: 1-byte, 2-byte and 3-byte descriptors', () => {
    const { receiver } = makeReceiver();
    expect(receiver.decodeLength(new Uint8Array([0x05]))).toEqual([1, 5]);
    // 0x80 | 0x01 → ((1) << 8) | 0x02 = 258
    expect(receiver.decodeLength(new Uint8Array([0x81, 0x02]))).toEqual([2, 258]);
    // 0xC0 | 0x01, then 0x02, 0x03 → (1 << 16) | (2 << 8) | 3
    expect(receiver.decodeLength(new Uint8Array([0xc1, 0x02, 0x03]))).toEqual([
      3,
      0x010203,
    ]);
  });

  test('routes a complete !done sentence (with ret + tag) to the tag callback', () => {
    const { receiver } = makeReceiver();
    const packets: string[][] = [];
    receiver.read('t1', (p) => packets.push(p));

    receiver.processRawData(
      encodeSentence(['!done', '=ret=*3', '.tag=t1'])
    );

    expect(packets).toEqual([['!done', '=ret=*3']]);
  });

  test('reassembles a sentence split across a chunk boundary', () => {
    const { receiver } = makeReceiver();
    const packets: string[][] = [];
    receiver.read('t1', (p) => packets.push(p));

    const frame = encodeSentence(['!done', '=ret=*7', '.tag=t1']);
    // Split inside the first word's content to force cross-chunk reassembly.
    receiver.processRawData(frame.slice(0, 3));
    expect(packets).toHaveLength(0);
    receiver.processRawData(frame.slice(3));

    expect(packets).toEqual([['!done', '=ret=*7']]);
  });

  test('routes a !trap sentence preserving its attributes', () => {
    const { receiver } = makeReceiver();
    const packets: string[][] = [];
    receiver.read('t1', (p) => packets.push(p));

    receiver.processRawData(
      encodeSentence([
        '!trap',
        '=category=0',
        '=message=no such item',
        '.tag=t1',
      ])
    );

    expect(packets).toEqual([
      ['!trap', '=category=0', '=message=no such item'],
    ]);
  });

  test('routes a !empty sentence (RouterOS v7.18+)', () => {
    const { receiver } = makeReceiver();
    const packets: string[][] = [];
    receiver.read('t1', (p) => packets.push(p));

    receiver.processRawData(encodeSentence(['!empty', '.tag=t1']));

    expect(packets).toEqual([['!empty']]);
  });

  test('emits fatal on the socket for a !fatal sentence', () => {
    const { socket, receiver } = makeReceiver();
    const fatal = jest.fn();
    socket.on('fatal', fatal);

    receiver.processRawData(
      encodeSentence(['!fatal', '=message=bad', '.tag=t1'])
    );

    expect(fatal).toHaveBeenCalledTimes(1);
  });

  test('ignores data for an unregistered tag (late reply after close)', () => {
    const { receiver } = makeReceiver();
    expect(() =>
      receiver.processRawData(encodeSentence(['!done', '.tag=gone']))
    ).not.toThrow();
  });

  test('encodeWord round-trips a 2-byte length descriptor word', () => {
    // 200 chars forces a 2-byte length prefix (> 0x7F).
    const word = 'x'.repeat(200);
    const frame = encodeWord(word);
    expect(frame[0] & 0x80).toBe(0x80);
    expect(frame.length).toBe(202);
  });
});

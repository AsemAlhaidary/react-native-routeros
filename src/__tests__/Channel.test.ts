import { Channel } from '../Channel';
import { RosException } from '../RosException';
import { RosTrapException } from '../RosTrapException';

/** Minimal Connector stand-in: captures writes, routes delivered packets by tag. */
class FakeConnector {
  readers = new Map<string, (packet: string[]) => void>();
  writes: string[][] = [];

  read(tag: string, cb: (packet: string[]) => void): void {
    this.readers.set(tag, cb);
  }
  stopRead(tag: string): void {
    this.readers.delete(tag);
  }
  write(words: string[]): void {
    this.writes.push(words);
  }
  deliver(tag: string, packet: string[]): void {
    this.readers.get(tag)?.(packet);
  }
}

function makeChannel(fake: FakeConnector): Channel {
  return new Channel(fake as any);
}

/** Extract the `.tag=` word appended to the channel's command. */
function tagOf(fake: FakeConnector, writeIndex = 0): string {
  const word = fake.writes[writeIndex].find((w) => w.startsWith('.tag='))!;
  return word.slice('.tag='.length);
}

describe('Channel', () => {
  test('writeWithMeta resolves records + ret from !done =ret=', async () => {
    const fake = new FakeConnector();
    const ch = makeChannel(fake);

    const p = ch.writeWithMeta(['/ip/hotspot/user/add', '=name=x']);
    expect(fake.writes[0][0]).toBe('/ip/hotspot/user/add');
    expect(fake.writes[0].at(-1)).toMatch(/^\.tag=/);
    fake.deliver(tagOf(fake), ['!done', '=ret=*3']);

    await expect(p).resolves.toEqual({
      records: [{ ret: '*3' }],
      ret: '*3',
    });
  });

  test('write() keeps node-routeros parity — resolves the bare records array', async () => {
    const fake = new FakeConnector();
    const ch = makeChannel(fake);

    const p = ch.write(['/ip/address/print']);
    fake.deliver(tagOf(fake), ['!re', '=address=10.0.0.1']);
    fake.deliver(tagOf(fake), ['!done']);

    await expect(p).resolves.toEqual([{ address: '10.0.0.1' }]);
  });

  test('ret is absent when the router returns a plain print', async () => {
    const fake = new FakeConnector();
    const ch = makeChannel(fake);

    const p = ch.writeWithMeta(['/ip/address/print']);
    fake.deliver(tagOf(fake), ['!done']);

    await expect(p).resolves.toEqual({ records: [], ret: undefined });
  });

  test('ret is absent when the command is trapped', async () => {
    const fake = new FakeConnector();
    const ch = makeChannel(fake);

    const p = ch.writeWithMeta(['/user/remove', '=.id=*1']);
    fake.deliver(tagOf(fake), [
      '!trap',
      '=category=0',
      '=message=no such item',
    ]);

    await expect(p).rejects.toMatchObject({ errno: 'TRAP' });
  });

  test('trap rejects a RosTrapException with verbatim attributes', async () => {
    const fake = new FakeConnector();
    const ch = makeChannel(fake);

    const p = ch.writeWithMeta(['/x']);
    fake.deliver(tagOf(fake), [
      '!trap',
      '=category=0',
      '=message=no such item',
      '=place=/user/remove',
    ]);

    const err = await p.catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(RosException);
    expect(err).toBeInstanceOf(RosTrapException);
    expect(err.trapAttributes).toEqual({
      category: '0',
      message: 'no such item',
      place: '/user/remove',
    });
    expect(err.errno).toBe('TRAP');
    // Non-streaming channels close on trap — receiver tag released (no leak).
    expect(fake.readers.size).toBe(0);
  });

  test('non-trap RosException is untouched (SOCKTMOUT still plain)', () => {
    const e = new RosException('SOCKTMOUT', { seconds: '10' });
    expect(e).not.toBeInstanceOf(RosTrapException);
    expect(e.errno).toBe('SOCKTMOUT');
    expect(e.message).toBe('Timed out after 10 seconds');
  });

  describe('timeout (F5)', () => {
    afterEach(() => jest.useRealTimers());

    test('unanswered command rejects TIMEOUT inside timeoutMs and cleans up the tag', async () => {
      jest.useFakeTimers();
      const fake = new FakeConnector();
      const ch = makeChannel(fake);

      const p = ch.writeWithMeta(['/slow'], { timeoutMs: 50 });
      expect(fake.readers.size).toBe(1);

      const assertion = expect(p).rejects.toMatchObject({
        errno: 'TIMEOUT',
      });
      jest.advanceTimersByTime(100);
      await assertion;

      expect(fake.readers.size).toBe(0);
    });

    test('a sibling channel is unaffected by another channel timing out', async () => {
      jest.useFakeTimers();
      const fake = new FakeConnector();
      const a = makeChannel(fake);
      const b = makeChannel(fake);

      const pa = a.writeWithMeta(['/a'], { timeoutMs: 50 });
      const pb = b.writeWithMeta(['/b']);

      const bAssert = expect(pb).resolves.toEqual({
        records: [],
        ret: undefined,
      });
      fake.deliver(tagOf(fake, 1), ['!done']);

      const aAssert = expect(pa).rejects.toMatchObject({ errno: 'TIMEOUT' });
      jest.advanceTimersByTime(100);
      await Promise.all([bAssert, aAssert]);
    });
  });

  test('abort() rejects CANCELLED and sends /cancel for the channel tag', async () => {
    const fake = new FakeConnector();
    const ch = makeChannel(fake);
    const ac = new AbortController();

    const p = ch.writeWithMeta(['/slow'], { signal: ac.signal });
    const tag = tagOf(fake, 0);
    ac.abort();

    await expect(p).rejects.toMatchObject({ errno: 'CANCELLED' });
    expect(
      fake.writes.some(
        (w) => w[0] === '/cancel' && w[1] === '=tag=' + tag
      )
    ).toBe(true);
    expect(fake.readers.has(tag)).toBe(false);
  });
});
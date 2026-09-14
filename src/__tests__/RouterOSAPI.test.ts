import { AppState } from 'react-native';
import { RouterOSAPI } from '../RouterOSAPI';
import { RosException } from '../RosException';
import { RosTrapException } from '../RosTrapException';
import {
  FakeSocket,
  encodeSentence,
  lastSocket,
  resetSockets,
} from '../../test/unit/mocks/react-native-tcp-socket';

function buildApi(overrides: Record<string, unknown> = {}): RouterOSAPI {
  return new RouterOSAPI({
    host: '192.0.2.1',
    user: 'admin',
    password: 'pw',
    port: 8728,
    timeout: 1,
    ...overrides,
  } as any);
}

/** Test helpers exposed by the AppState unit mock. */
const appStateMock = AppState as unknown as {
  __listenerCount(): number;
  __reset(): void;
};

function sentences(socket: FakeSocket, idx = -1): string[] {
  const s = socket.sentences();
  return s[idx < 0 ? s.length + idx : idx];
}

function tagOfSentence(socket: FakeSocket, idx = -1): string {
  const w = sentences(socket, idx).find((x) => x.startsWith('.tag='))!;
  return w.slice('.tag='.length);
}

const tick = () => new Promise((r) => setImmediate(r));

/** Complete the fast-path (no-challenge) login handshake. */
function completeFastLogin(socket: FakeSocket): void {
  socket.emitData(encodeSentence(['!done', '.tag=' + tagOfSentence(socket, 0)]));
}

/** Connect and finish the fast-path login. */
async function connectFast(api: RouterOSAPI): Promise<void> {
  const p = api.connect();
  completeFastLogin(lastSocket());
  await p;
}

beforeEach(() => {
  resetSockets();
  appStateMock.__reset();
});

describe('RouterOSAPI connection state (F3)', () => {
  test('connected is false before connect, true after, false after close', async () => {
    const api = buildApi();
    expect(api.connected).toBe(false);

    await connectFast(api);
    expect(api.connected).toBe(true);
    expect(api.connecting).toBe(false);

    await api.close();
    expect(api.connected).toBe(false);
  });

  test('login sends /login then resolves on the fast path', async () => {
    const api = buildApi();
    const p = api.connect();
    const socket = lastSocket();

    expect(sentences(socket, 0)[0]).toBe('/login');
    expect(sentences(socket, 0)).toContain('=name=admin');

    completeFastLogin(socket);
    await expect(p).resolves.toBe(api);
  });

  test('MD5 challenge path: second /login carries =response=00<hex>', async () => {
    const api = buildApi({ password: 'secret' });
    const p = api.connect();
    const socket = lastSocket();

    socket.emitData(
      encodeSentence([
        '!done',
        '=ret=' + 'a'.repeat(32),
        '.tag=' + tagOfSentence(socket, 0),
      ])
    );
    await tick();

    const second = sentences(socket, 0); // may be merged; find the response login
    const secondLogin = socket.sentences().find((s) => s[0] === '/login' && s.some((w) => w.startsWith('=response=')));
    expect(secondLogin).toBeDefined();
    const resp = secondLogin!.find((w) => w.startsWith('=response='))!;
    expect(resp).toMatch(/^=response=00[0-9a-f]{32}$/);

    socket.emitData(
      encodeSentence(['!done', '.tag=' + tagOfSentence(socket, -1)])
    );
    await expect(p).resolves.toBe(api);
    void second;
  });
});

describe('writeCommand (E1)', () => {
  test('resolves { records, ret, tag } — ret is the created .id', async () => {
    const api = buildApi();
    await connectFast(api);
    const socket = lastSocket();

    const p = api.writeCommand('/ip/hotspot/user/add', ['=name=wasl', '=password=x']);
    expect(sentences(socket, -1)[0]).toBe('/ip/hotspot/user/add');
    expect(sentences(socket, -1)).toContain('=name=wasl');
    expect(sentences(socket, -1).at(-1)).toMatch(/^\.tag=/);

    socket.emitData(
      encodeSentence(['!done', '=ret=*3', '.tag=' + tagOfSentence(socket, -1)])
    );

    const result = await p;
    expect(result.ret).toBe('*3');
    expect(result.tag).toBe(tagOfSentence(socket, -1));
    expect(Array.isArray(result.records)).toBe(true);
  });

  test('rejects RosTrapException with verbatim trap attributes', async () => {
    const api = buildApi();
    await connectFast(api);
    const socket = lastSocket();

    const p = api.writeCommand('/user/remove', ['=.id=*1']);
    socket.emitData(
      encodeSentence([
        '!trap',
        '=category=0',
        '=message=no such item',
        '.tag=' + tagOfSentence(socket, -1),
      ])
    );

    const err = await p.catch((e) => e);
    expect(err).toBeInstanceOf(RosTrapException);
    expect(err).toBeInstanceOf(RosException);
    expect(err.trapAttributes.category).toBe('0');
    expect(err.trapAttributes.message).toBe('no such item');
  });
});

describe('close() idempotency + abort (F4)', () => {
  test('double close() resolves both — never ALRDYCLOSNG', async () => {
    const api = buildApi();
    await connectFast(api);

    const [r1, r2] = await Promise.all([api.close(), api.close()]);
    expect(r1).toBe(api);
    expect(r2).toBe(api);
    expect(api.connected).toBe(false);
  });

  test('close() before connect() resolves', async () => {
    const api = buildApi();
    await expect(api.close()).resolves.toBe(api);
  });

  test('close() mid-connect aborts and connect() settles CANCELLED', async () => {
    const api = buildApi();
    const p = api.connect();
    expect(api.connecting).toBe(true);

    const closeP = api.close();
    await expect(p).rejects.toMatchObject({ errno: 'CANCELLED' });
    await expect(closeP).resolves.toBe(api);
    expect(api.connected).toBe(false);
    expect(api.connecting).toBe(false);
  });

  test('setOptions()+connect() works again after close() (CONN-05)', async () => {
    const api = buildApi();
    await connectFast(api);
    await api.close();

    api.setOptions({ host: '192.0.2.2', user: 'admin', password: 'pw' });
    await connectFast(api);
    expect(api.connected).toBe(true);
    await api.close();
  });
});

describe('write after close / drop (F7)', () => {
  test('writeCommand after close rejects NOTCONNECTED — never a TypeError', async () => {
    const api = buildApi();
    await connectFast(api);
    await api.close();

    const err = await api.writeCommand('/ip/address/print').catch((e) => e);
    expect(err).toBeInstanceOf(RosException);
    expect(err.errno).toBe('NOTCONNECTED');
    expect(err).not.toBeInstanceOf(TypeError);
  });

  test('write() after close rejects NOTCONNECTED asynchronously', async () => {
    const api = buildApi();
    await connectFast(api);
    await api.close();

    await expect(api.write('/ip/address/print')).rejects.toMatchObject({
      errno: 'NOTCONNECTED',
    });
  });

  test('unexpected drop: connected false + AppState listener removed (F6)', async () => {
    const api = buildApi();
    await connectFast(api);
    expect(appStateMock.__listenerCount()).toBe(1);
    expect(api.connected).toBe(true);

    lastSocket().emitClose();

    expect(api.connected).toBe(false);
    expect(appStateMock.__listenerCount()).toBe(0);
  });

  test('close() removes the AppState listener', async () => {
    const api = buildApi();
    await connectFast(api);
    expect(appStateMock.__listenerCount()).toBe(1);

    await api.close();
    expect(appStateMock.__listenerCount()).toBe(0);
  });
});
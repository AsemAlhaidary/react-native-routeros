import { Connector } from '../Connector';
import { RosException } from '../RosException';
import {
  FakeSocket,
  encodeSentence,
  lastSocket,
  resetSockets,
} from '../../test/unit/mocks/react-native-tcp-socket';

function makeConnector(): Connector {
  return new Connector({ host: '192.0.2.1', port: 8728, timeout: 1 });
}

const tick = () => new Promise((r) => setImmediate(r));

beforeEach(() => resetSockets());

describe('Connector events', () => {
  test('connect() creates the socket and emits connected once', async () => {
    const c = makeConnector();
    const onConnected = jest.fn();
    c.once('connected', onConnected);

    c.connect();

    expect(lastSocket()).toBeInstanceOf(FakeSocket);
    await tick();
    expect(onConnected).toHaveBeenCalledTimes(1);
  });

  test('socket data routes to a registered tag callback', () => {
    const c = makeConnector();
    c.connect();
    const cb = jest.fn();
    c.read('t1', cb);

    lastSocket().emitData(encodeSentence(['!done', '.tag=t1']));

    expect(cb).toHaveBeenCalledWith(['!done']);
  });

  test('socket error emits a RosException and destroys the socket', () => {
    const c = makeConnector();
    c.connect();
    const onError = jest.fn();
    c.once('error', onError);
    const sock = lastSocket();

    sock.emitError(new Error('boom'));

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toBeInstanceOf(RosException);
    expect(sock.destroyed).toBe(true);
  });

  test('socket timeout emits a SOCKTMOUT RosException', () => {
    const c = makeConnector();
    c.connect();
    const onTimeout = jest.fn();
    c.once('timeout', onTimeout);

    lastSocket().emitTimeout();

    expect(onTimeout).toHaveBeenCalledTimes(1);
    expect(onTimeout.mock.calls[0][0]).toMatchObject({ errno: 'SOCKTMOUT' });
  });

  test('socket close emits close (drop detection)', () => {
    const c = makeConnector();
    c.connect();
    const onClose = jest.fn();
    c.once('close', onClose);

    lastSocket().emitClose();

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('Connector idle-timeout vs keepalive', () => {
  test('arms the destructive idle timeout when keepalive is off', () => {
    const spy = jest.spyOn(FakeSocket.prototype, 'setTimeout');
    const c = new Connector({ host: '192.0.2.1', port: 8728, timeout: 60 });

    c.connect();

    expect(spy).toHaveBeenCalledWith(60000);
    spy.mockRestore();
  });

  test('does NOT arm the idle timeout when keepalive is on', () => {
    const spyTimeout = jest.spyOn(FakeSocket.prototype, 'setTimeout');
    const spyKeepAlive = jest.spyOn(FakeSocket.prototype, 'setKeepAlive');
    const c = new Connector({ host: '192.0.2.1', port: 8728, timeout: 60, keepalive: true });

    c.connect();

    expect(spyTimeout).not.toHaveBeenCalled();
    expect(spyKeepAlive).toHaveBeenCalledWith(true);
    spyTimeout.mockRestore();
    spyKeepAlive.mockRestore();
  });
});
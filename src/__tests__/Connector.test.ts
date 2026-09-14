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

beforeEach(() => resetSockets());

describe('Connector events', () => {
  test('connect() creates the socket and emits connected once', () => {
    const c = makeConnector();
    const onConnected = jest.fn();
    c.once('connected', onConnected);

    c.connect();

    expect(lastSocket()).toBeInstanceOf(FakeSocket);
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
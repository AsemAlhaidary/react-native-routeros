import { RosException } from '../RosException';
import { RosTrapException } from '../RosTrapException';
import messages from '../messages';

describe('RosException', () => {
  test('resolves a catalog message and substitutes {{placeholders}}', () => {
    const err = new RosException('SOCKTMOUT', { seconds: '10' });
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(RosException);
    expect(err.errno).toBe('SOCKTMOUT');
    expect(err.name).toBe('RosException');
    expect(err.message).toBe('Timed out after 10 seconds');
  });

  test('substitutes every occurrence of a placeholder', () => {
    const err = new RosException('UNKNOWNREPLY', { reply: '!wat' });
    expect(err.message).toBe('Tried to process unknown reply: !wat');
  });

  test('surfaces extras.message for an errno not in the catalog', () => {
    const err = new RosException('ERR_SSL_ALERT', { message: 'handshake fail' });
    expect(err.errno).toBe('ERR_SSL_ALERT');
    expect(err.message).toBe('handshake fail');
  });

  test('exposes the catalog as the exported messages object', () => {
    expect(messages.CANTLOGIN).toBe('Username or password is invalid');
  });
});

describe('RosTrapException', () => {
  test('instanceof chain: Error → RosException → RosTrapException', () => {
    const err = new RosTrapException({
      category: '0',
      message: 'no such item',
      place: '/user/remove',
    });
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(RosException);
    expect(err).toBeInstanceOf(RosTrapException);
    expect(err.name).toBe('RosTrapException');
    expect(err.errno).toBe('TRAP');
    expect(err.message).toBe('no such item');
    expect(err.trapAttributes).toEqual({
      category: '0',
      message: 'no such item',
      place: '/user/remove',
    });
  });

  test('falls back to a default message when the trap has no message', () => {
    const err = new RosTrapException({ category: '1' });
    expect(err.message).toBe('RouterOS trap');
  });
});

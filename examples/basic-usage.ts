/**
 * basic-usage.ts — canonical end-to-end example for `react-native-routeros`.
 *
 * Walks the single happy path:
 *
 *   connect → (internal login) → write → close
 *
 * `connect()` performs the RouterOS MD5 challenge-response login internally
 * (RouterOS v6/v7). There is no separate public login method — the connect
 * call is the login call.
 *
 * NOTE: The credentials below are placeholders. In a real app, load them from
 * environment variables or a secure key store — never hardcode real credentials.
 */
import { RouterOSAPI, RosException } from 'react-native-routeros';

async function basicUsage(): Promise<void> {
  // Placeholder credentials — substitute real values from env vars / a secure key store.
  const api = new RouterOSAPI({
    host: '192.168.88.1',
    user: 'admin',
    password: 'password',
    timeout: 10,
  });

  try {
    // connect() opens the TCP/TLS connection and logs in automatically.
    await api.connect();

    // Issue one read command and iterate the parsed response objects
    // (an array of Record<string, any> keyed by RouterOS field name).
    const resources = await api.write('/system/resource/print');
    for (const resource of resources) {
      console.log('Resource:', resource);
    }

    // Gracefully close the connection.
    await api.close();
  } catch (err) {
    if (err instanceof RosException) {
      // RosException exposes readonly errno and message (plus name === 'RosException').
      console.error('RouterOS error:', err.errno, err.message);
    } else {
      console.error('Unexpected error:', err);
    }
  }
}

export default basicUsage;

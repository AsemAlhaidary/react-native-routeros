/**
 * Exported errno constants for the RouterOS protocol-level errors, so
 * consumers stop hardcoding magic strings.
 *
 * Only the protocol keys the library itself raises are listed here — the
 * POSIX/network errno catalog in `messages.ts` is surfaced by the OS, not
 * raised by this library.
 */
export const RosErrno = {
  TRAP: 'TRAP',
  TIMEOUT: 'TIMEOUT',
  CANCELLED: 'CANCELLED',
  CLOSED: 'CLOSED',
  NOTCONNECTED: 'NOTCONNECTED',
  CANTLOGIN: 'CANTLOGIN',
  SOCKTMOUT: 'SOCKTMOUT',
  UNKNOWNREPLY: 'UNKNOWNREPLY',
  UNREGISTEREDTAG: 'UNREGISTEREDTAG',
  STREAMCLOSD: 'STREAMCLOSD',
  ALRDYSTREAMING: 'ALRDYSTREAMING',
  CANTWRTWHLSTRMG: 'CANTWRTWHLSTRMG',
  ALRDYCLOSNG: 'ALRDYCLOSNG',
  ALRDYCONNECTING: 'ALRDYCONNECTING',
  REFNOTFND: 'REFNOTFND',
} as const;
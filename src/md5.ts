import { md5 } from 'js-md5';

/**
 * MD5 hash wrapper for RouterOS login challenge-response.
 * Accepts Uint8Array or ArrayBuffer — critical because the RouterOS
 * login challenge constructs a binary buffer of 0x00 + password bytes
 * + challenge hex bytes (not a UTF-8 string).
 *
 * Uses js-md5 which natively supports Uint8Array and ArrayBuffer.
 *
 * @param data - Binary input buffer
 * @returns Lowercase hex string (32 characters)
 */
export function md5Hash(data: Uint8Array | ArrayBuffer): string {
  return md5(data);
}

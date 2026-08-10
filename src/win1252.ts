// Windows-1252 codec — zero-dependency lookup table implementation.
// Mirrors iconv-lite's win1252 behavior for the RouterOS protocol.
//
// Bytes 0x00–0x7F: direct ASCII mapping
// Bytes 0x80–0x9F: 27 special characters (Euro sign, smart quotes, dashes, etc.)
// Bytes 0xA0–0xFF: direct Latin-1 supplement (identical to Unicode U+00A0–U+00FF)

/**
 * Maps win1252 byte values 0x80–0xFF to Unicode code points.
 * Undefined slots (0x81, 0x8D, 0x8F, 0x90, 0x9D) store 0x00 —
 * the fallback path in decodeWin1252 returns the raw byte.
 */
const WIN1252_TO_UNICODE = new Uint16Array([
  0x20ac, // 0x80 = €
  0x0000, // 0x81 = undefined
  0x201a, // 0x82 = ‚
  0x0192, // 0x83 = ƒ
  0x201e, // 0x84 = „
  0x2026, // 0x85 = …
  0x2020, // 0x86 = †
  0x2021, // 0x87 = ‡
  0x02c6, // 0x88 = ˆ
  0x2030, // 0x89 = ‰
  0x0160, // 0x8a = Š
  0x2039, // 0x8b = ‹
  0x0152, // 0x8c = Œ
  0x0000, // 0x8d = undefined
  0x017d, // 0x8e = Ž
  0x0000, // 0x8f = undefined
  0x0000, // 0x90 = undefined
  0x2018, // 0x91 = '
  0x2019, // 0x92 = '
  0x201c, // 0x93 = "
  0x201d, // 0x94 = "
  0x2022, // 0x95 = o
  0x2013, // 0x96 = -
  0x2014, // 0x97 = -
  0x02dc, // 0x98 = ~
  0x2122, // 0x99 = TM
  0x0161, // 0x9a = s
  0x203a, // 0x9b = >
  0x0153, // 0x9c = oe
  0x0000, // 0x9d = undefined
  0x017e, // 0x9e = z
  0x0178, // 0x9f = Y
  // 0xa0–0xff: direct Unicode mapping (U+00A0–U+00FF) handled inline
]);

/**
 * Reverse mapping for encode: Unicode code point → win1252 byte.
 * Only the 27 special characters from the 0x80–0x9F range.
 * Latin-1 supplement (0xA0–0xFF) is a direct passthrough.
 */
const WIN1252_FROM_UNICODE = new Map<number, number>([
  [0x20ac, 0x80], // €
  [0x201a, 0x82], // ‚
  [0x0192, 0x83], // ƒ
  [0x201e, 0x84], // „
  [0x2026, 0x85], // …
  [0x2020, 0x86], // †
  [0x2021, 0x87], // ‡
  [0x02c6, 0x88], // ˆ
  [0x2030, 0x89], // ‰
  [0x0160, 0x8a], // Š
  [0x2039, 0x8b], // ‹
  [0x0152, 0x8c], // Œ
  [0x017d, 0x8e], // Ž
  [0x2018, 0x91], // '
  [0x2019, 0x92], // '
  [0x201c, 0x93], // "
  [0x201d, 0x94], // "
  [0x2022, 0x95], // o
  [0x2013, 0x96], // -
  [0x2014, 0x97], // -
  [0x02dc, 0x98], // ~
  [0x2122, 0x99], // TM
  [0x0161, 0x9a], // s
  [0x203a, 0x9b], // >
  [0x0153, 0x9c], // oe
  [0x017e, 0x9e], // z
  [0x0178, 0x9f], // Y
]);

/**
 * Decode a Windows-1252 byte array to a UTF-16 string.
 * Uses String.fromCharCode (single code point, not surrogate pairs — win1252 is single-byte).
 */
export function decodeWin1252(bytes: Uint8Array): string {
  let result = '';
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b < 0x80) {
      // ASCII: direct mapping
      result += String.fromCharCode(b);
    } else if (b < 0xa0) {
      // 0x80–0x9F: lookup table (27 special characters)
      const cp = WIN1252_TO_UNICODE[b - 0x80];
      result += String.fromCharCode(cp !== 0 ? cp : b);
    } else {
      // 0xA0–0xFF: direct Latin-1 supplement
      result += String.fromCharCode(b);
    }
  }
  return result;
}

/**
 * Encode a UTF-16 string to Windows-1252 bytes.
 * Characters that cannot be mapped to win1252 are encoded as 0x3F (ASCII '?').
 */
export function encodeWin1252(str: string): Uint8Array {
  const result = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) {
    const cp = str.charCodeAt(i);
    if (cp < 0x80) {
      // ASCII: direct mapping
      result[i] = cp;
    } else if (cp >= 0xa0 && cp <= 0xff) {
      // Latin-1 supplement: direct passthrough
      result[i] = cp;
    } else {
      // Special characters: reverse lookup
      result[i] = WIN1252_FROM_UNICODE.get(cp) ?? 0x3f; // '?' for unmappable
    }
  }
  return result;
}

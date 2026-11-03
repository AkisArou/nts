const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

// Keep this fixture focused on the bit-counter loops: importing jwk.ts also
// lowers unrelated JWK entry points that main intentionally refuses. These
// local helpers mirror the production loops and their alphabet/length rules.
function base64Digit(code: number): number {
  if (code >= 65 && code <= 90) return code - 65;
  if (code >= 97 && code <= 122) return code - 97 + 26;
  if (code >= 48 && code <= 57) return code - 48 + 52;
  if (code === 45) return 62;
  if (code === 95) return 63;
  return -1;
}

function decodeBase64Url(value: string): Uint8Array {
  if (value.length % 4 === 1) throw new TypeError("Invalid base64url length");
  const result = new Uint8Array(Math.floor(value.length * 6 / 8));
  let accumulator = 0;
  let bits = 0;
  let output = 0;
  for (let index = 0; index < value.length; index++) {
    const digit = base64Digit(value.charCodeAt(index));
    if (digit < 0) throw new TypeError("Invalid base64url character");
    accumulator = (accumulator << 6) | digit;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      result[output++] = (accumulator >>> bits) & 255;
    }
  }
  return result;
}

function encodeBase64Url(bytes: Uint8Array): string {
  let result = "";
  const length = bytes.length;
  for (let index = 0; index < length; index += 3) {
    const a = bytes[index]!;
    const b = index + 1 < length ? bytes[index + 1]! : 0;
    const c = index + 2 < length ? bytes[index + 2]! : 0;
    result += alphabet[a >>> 2]! + alphabet[((a & 3) << 4) | (b >>> 4)]!;
    if (index + 1 < length) result += alphabet[((b & 15) << 2) | (c >>> 6)]!;
    if (index + 2 < length) result += alphabet[c & 63]!;
  }
  return result;
}

/**
 * The byte widths exercise the decoder's 0, 6, 4, 2 bit phase and the encoder's
 * 0/1/2-byte tails. For every length from zero through eight, rotate the full
 * URL-safe alphabet through every position; this covers all four remainders,
 * including the invalid remainder one, without an exponential Cartesian set.
 */
export function allAlphabetBoundaries(): string {
  const byLength: number[] = [];
  for (let length = 0; length <= 8; length++) {
    let digest = 0;
    for (let start = 0; start < alphabet.length; start++) {
      let input = "";
      for (let index = 0; index < length; index++) {
        input += alphabet[(start + index) % alphabet.length];
      }
      try {
        const bytes = decodeBase64Url(input);
        const encoded = encodeBase64Url(bytes);
        digest = (digest * 33 + bytes.length + encoded.length) | 0;
      } catch {
        // The required boundary here is that remainder one throws. Error
        // subclass naming is exercised by the JWK exception fixtures.
        digest = (digest * 33 + input.length) | 0;
      }
    }
    byLength.push(digest);
  }
  return byLength.join(",");
}

// One difference from the helpers' fixed 8-bit phase: the wrap threshold is
// supplied by an unchecked caller, so this control cannot use the same range.
export function dynamicWrapControl(text: string, threshold: number): number {
  let bits = 0;
  for (let index = 0; index < text.length; index++) {
    bits += 6;
    if (bits >= threshold) bits -= threshold;
  }
  return bits;
}

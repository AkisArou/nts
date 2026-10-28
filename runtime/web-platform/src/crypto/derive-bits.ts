const ByteArray = Uint8Array;

/**
 * Web Cryptography §§24.4.2 and 26.3.1: retain the requested leading bits and
 * clear the unused low bits of the final octet. Callers validate the length and
 * the native result first. The native secret already owns its exact-size buffer.
 */
export function truncateDerivationBits(secret: Uint8Array, length: number | null): Uint8Array {
  if (length === null || length === secret.byteLength * 8) return secret;
  const remainder = length % 8;
  const byteLength = (length - remainder) / 8 + (remainder === 0 ? 0 : 1);
  const result = new ByteArray(byteLength);
  for (let index = 0; index < byteLength; index++) result[index] = secret[index]!;
  if (remainder !== 0) result[byteLength - 1]! &= 0xff << (8 - remainder);
  return result;
}

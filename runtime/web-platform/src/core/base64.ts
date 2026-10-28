import { isASCIIWhitespace } from "./ascii.ts";

// The byte and binary-string loops stay in this native-replacement boundary.
// HTML argument conversion and exception policy live in base64-globals.ts.
const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Infra's forgiving-base64 encoder, shared with File API and HTTP proxy auth. */
export function forgivingBase64Encode(bytes: Uint8Array): string {
  let result = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const second = bytes[index + 1] ?? 0;
    const third = bytes[index + 2] ?? 0;
    result +=
      BASE64_ALPHABET.charAt(first >>> 2) +
      BASE64_ALPHABET.charAt(((first & 3) << 4) | (second >>> 4));
    result +=
      index + 1 < bytes.length ? BASE64_ALPHABET.charAt(((second & 15) << 2) | (third >>> 6)) : "=";
    result += index + 2 < bytes.length ? BASE64_ALPHABET.charAt(third & 63) : "=";
  }
  return result;
}

/** HTML's binary string uses one byte per code unit; failure must not truncate. */
export function base64BinaryStringToBytes(input: string): Uint8Array | null {
  const bytes = new Uint8Array(input.length);
  for (let index = 0; index < input.length; index++) {
    const unit = input.charCodeAt(index);
    if (unit > 0xff) return null;
    bytes[index] = unit;
  }
  return bytes;
}

/** Map each decoded byte to the same-valued code unit, without UTF-8 decoding. */
export function base64BytesToBinaryString(bytes: Uint8Array): string {
  let result = "";
  for (let index = 0; index < bytes.length; index++) {
    result += String.fromCharCode(bytes[index]!);
  }
  return result;
}

function base64Value(code: number): number {
  if (code >= 0x41 && code <= 0x5a) return code - 0x41;
  if (code >= 0x61 && code <= 0x7a) return code - 0x61 + 26;
  if (code >= 0x30 && code <= 0x39) return code - 0x30 + 52;
  if (code === 0x2b) return 62;
  if (code === 0x2f) return 63;
  return -1;
}

/** Infra's forgiving-base64 decoder. Failure is distinct from an empty result. */
export function forgivingBase64Decode(input: Uint8Array): Uint8Array | null {
  let significantLength = 0;
  for (let index = 0; index < input.length; index++) {
    const byte = input[index];
    if (byte !== undefined && !isASCIIWhitespace(byte)) significantLength++;
  }

  let end = significantLength;
  if (end % 4 === 0) {
    let removedPadding = 0;
    for (let index = input.length - 1; index >= 0 && removedPadding < 2; index--) {
      const byte = input[index];
      if (byte === undefined || isASCIIWhitespace(byte)) continue;
      if (byte !== 0x3d) break;
      end--;
      removedPadding++;
    }
  }
  if (end % 4 === 1) return null;

  const output = new Uint8Array(Math.floor((end * 6) / 8));
  let accumulator = 0;
  let bits = 0;
  let read = 0;
  let written = 0;
  for (let index = 0; index < input.length && read < end; index++) {
    const byte = input[index];
    if (byte === undefined || isASCIIWhitespace(byte)) continue;
    read++;
    const value = base64Value(byte);
    if (value < 0) return null;
    accumulator = (accumulator << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      output[written++] = (accumulator >> bits) & 0xff;
    }
    if (bits === 0) accumulator = 0;
  }
  return output;
}

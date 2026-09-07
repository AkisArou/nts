import { isASCIIWhitespace } from "./ascii.ts";

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

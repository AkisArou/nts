import { utf8Length, utf8Write } from "./utf8.ts";

function asciiHexValue(code: number): number {
  if (code >= 0x30 && code <= 0x39) return code - 0x30;
  if (code >= 0x41 && code <= 0x46) return code - 0x41 + 10;
  if (code >= 0x61 && code <= 0x66) return code - 0x61 + 10;
  return -1;
}

/** URL percent-decoding over the UTF-8 bytes of a scalar-value string. */
export function percentDecodeBytes(input: string): Uint8Array {
  const raw = new Uint8Array(utf8Length(input));
  utf8Write(raw, input, 0, raw.length);

  let decodedLength = raw.length;
  for (let index = 0; index < raw.length; index++) {
    const first = raw[index + 1];
    const second = raw[index + 2];
    if (
      raw[index] === 0x25 &&
      first !== undefined &&
      second !== undefined &&
      asciiHexValue(first) >= 0 &&
      asciiHexValue(second) >= 0
    ) {
      decodedLength -= 2;
      index += 2;
    }
  }

  const output = new Uint8Array(decodedLength);
  let written = 0;
  for (let index = 0; index < raw.length; index++) {
    const byte = raw[index];
    if (byte === undefined) break;
    const first = raw[index + 1];
    const second = raw[index + 2];
    const high = first === undefined ? -1 : asciiHexValue(first);
    const low = second === undefined ? -1 : asciiHexValue(second);
    if (byte === 0x25 && high >= 0 && low >= 0) {
      output[written++] = high * 16 + low;
      index += 2;
    } else {
      output[written++] = byte;
    }
  }
  return output;
}

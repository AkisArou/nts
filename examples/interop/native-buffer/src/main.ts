import type { Ptr, c_uint8 } from "c:types";

// Operate directly on the caller's buffer. Neither an Array nor a copy is made.
// The caller must supply `length` live, writable bytes.
export function uppercaseAscii(bytes: Ptr<c_uint8>, length: number): number {
  let changed = 0;
  for (let i = 0; i < length; i++) {
    const byte = bytes[i];
    if (byte >= 97 && byte <= 122) {
      bytes[i] = byte - 32;
      changed++;
    }
  }
  return changed;
}

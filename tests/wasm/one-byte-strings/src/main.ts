// `String.fromCharCode` on Wasm reads a code unit below 256 from a table of
// the one-byte strings built once, and asks the engine for the rest
// (`strings::one_byte_strings`). Each function crosses the table's edge or
// wraps a number into it, against node.

// One code unit, whatever number arrives: below the edge, past it, negative,
// fractional, and past 2^16, which `ToUint16` wraps.
export function unit(code: number): string {
  return String.fromCharCode(code);
}

// Three hundred consecutive code units from a start below 512: the last of
// the table, its edge and past it in one string.
export function sweep(start: number): string {
  let out = "";
  const from = (start | 0) & 0x1ff;
  for (let code = from; code < from + 300; code++) {
    out += String.fromCharCode(code);
  }
  return out;
}

// Numbers that land in the table only after `ToUint16`: 2^16 above and below,
// a fraction truncated, and a value past 2^32.
export function wraps(n: number): string {
  const code = (n | 0) & 0xff;
  return (
    String.fromCharCode(code + 65536) +
    String.fromCharCode(code - 65536) +
    String.fromCharCode(code + 0.75) +
    String.fromCharCode(code + 4294967296)
  );
}

// The edge itself, and its neighbours, read back by their codes.
export function edge(offset: number): number {
  const code = 254 + ((offset | 0) & 3);
  const text = String.fromCharCode(code);
  return text.charCodeAt(0) * 10 + text.length;
}

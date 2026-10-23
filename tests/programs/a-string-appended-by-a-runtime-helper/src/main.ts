// What a runtime helper answers only to be appended is written into the
// string it extends (`hir::destinations`): `out + String(n)` is
// `nts_str_append_number(out, n)`, and so for `s[i]`, `s.charAt(i)`,
// `String.fromCharCode(c)` and `s.slice(a, b)`. In a variant too:
// `numberText` returns a helper's answer or a literal, so a caller's
// `out += numberText(v)` writes the number into `out` itself.
//
// Compared with node: every number form `String(n)` writes, units wide and
// narrow, indices inside and outside the string, slices with negative,
// reversed and NaN bounds and a slice of the string being built. `addNumber`
// takes its string over through the helper's slot; `keeps`, the
// one-difference control, reads its string after the append, so it is not
// giving it away, keeps borrowing, and the append copies.

function checksum(text: string): number {
  let sum = 0;
  for (let i = 0; i < text.length; i++) {
    sum = (sum * 31 + text.charCodeAt(i)) | 0;
  }
  return sum;
}

function numberText(value: number): string {
  return Number.isFinite(value) ? String(value) : "null";
}

function addNumber(out: string, n: number): string {
  return out + String(n);
}

function keeps(out: string, n: number): string {
  const grown = out + String(n);
  return grown + "/" + String(out.length);
}

const VALUES = [0, -0, 1.5, -7, 1e21, 1e-7, 0.1, NaN, Infinity, -Infinity, 5e-324, 123456789012345680000];

export function numbers(seed: number): number {
  let out = "[";
  for (let i = 0; i < VALUES.length; i++) {
    if (i !== 0) out += ",";
    out += numberText(VALUES[i]! + (seed & 0));
    out += String(i * (seed | 1));
  }
  out = addNumber(out, seed * 0.25);
  out = keeps(out, seed);
  return out.length * 1000 + (checksum(out) & 511);
}

const TEXT = "the quick brown fox ☺ jumps";

export function units(seed: number): number {
  let out = "";
  const shift = (seed & 7) - 4;
  for (let i = 0; i < TEXT.length; i++) {
    out += TEXT[i]!;
    out += TEXT.charAt(i + shift);
    out += String.fromCharCode(65 + ((i * 7 + seed) & 15));
  }
  out += String.fromCharCode(0x263a);
  out += String.fromCharCode(-1);
  return out.length * 1000 + (checksum(out) & 511);
}

export function slices(seed: number): number {
  let out = "<";
  const from = (seed & 15) - 6;
  out += TEXT.slice(from, from + 5);
  out += TEXT.slice(5, 2);
  out += TEXT.slice(NaN, 3);
  out += TEXT.slice(-4, 99);
  out += out.slice(1, 4);
  return out.length * 1000 + (checksum(out) & 511);
}

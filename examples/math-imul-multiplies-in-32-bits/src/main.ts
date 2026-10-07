// `Math.imul(a, b)`: ToInt32 of each operand, then the low 32 bits of the
// product as a signed integer -- the multiply in every JavaScript string hash.
// It was "not a member of this compiler's `Math`"
// (blockers/math-imul-is-not-a-member, the Chromium lane's row 22).

/** FNV-1a over a string, the way it is written in JavaScript. */
export function fnv(n: number): number {
  const text = "nts" + String(n);
  let hash = 0x811c9dc5 | 0;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** A product that wraps through the sign bit. */
export function wraps(n: number): number {
  return Math.imul(0x7fffffff, n);
}

/** Operands past 2^32, negative, fractional and not finite: ToInt32 of each. */
export function converts(n: number): number {
  return Math.imul(n, 4294967297) + Math.imul(-n, 3.9) + Math.imul(n * 0.5, 2) + Math.imul(n / 0, 7);
}

/** The largest operands, whose exact product needs 62 bits. */
export function extremes(n: number): number {
  return Math.imul(0xffffffff, 0xffffffff) + Math.imul(-2147483648, n) + Math.imul(2147483647, 2147483647);
}

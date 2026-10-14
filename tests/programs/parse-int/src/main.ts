// `parseInt(string, radix)`.
//
// Not `Number(s)` with a radix: the two disagree at almost every edge.
// `Number("")` is 0 and `parseInt("")` is NaN; `Number("12abc")` is NaN and
// `parseInt("12abc")` is 12; `Number` accepts exponents, `0b`/`0o` prefixes and
// a trailing `.5`, and `parseInt` accepts none of them. Stopping at the first
// character the radix does not admit is the whole of the difference.
//
// The radix defaults to **zero** rather than to ten, because zero is what the
// specification's "decide from the text" is: `parseInt("0x1f")` is 31 and
// `parseInt("0x1f", 10)` is 0. Defaulting to ten would answer the second for
// both, and `noRadix` against `radixTen` below is the pair that says so.
//
// 14 sites across 6 modules of `runtime/node`, and `os.networkInterfaces` is
// behind one of them through `getCIDR`.

// A `switch` rather than an array read, because `texts[i]!` makes the harness
// *decline* every case whose index it cannot prove -- and a declined case is not
// a compared one. The first version of this file reported "agreed on every
// case" over 42 of 203, with 17 declines, which is the fourth instrument of this
// session to report agreement while the interesting cases did not run.
function pick(n: number): string {
  switch (((n % 18) + 18) % 18) {
    case 0: return "42";
    case 1: return "  42";
    case 2: return "+42";
    case 3: return "-42";
    case 4: return "0x1f";
    case 5: return "12abc";
    case 6: return "abc";
    case 7: return "";
    case 8: return "007";
    case 9: return "3.9";
    case 10: return "1e3";
    case 11: return "  -0x10  ";
    case 12: return "0b11";
    case 13: return "z";
    case 14: return "10";
    case 15: return "2147483648";
    case 16: return "\t\n 77 \r";
    default: return "-  5";
  }
}

/** No radix at all, which is the case that has to read a `0x` prefix. */
export function noRadix(n: number): number {
  const parsed = parseInt(pick(n));
  return Number.isNaN(parsed) ? -999999 : parsed;
}

/** Ten written out, which must *not* read the prefix. */
export function radixTen(n: number): number {
  const parsed = parseInt(pick(n), 10);
  return Number.isNaN(parsed) ? -999999 : parsed;
}

/** Sixteen, which skips the prefix when it is there and works without it. */
export function radixSixteen(n: number): number {
  const parsed = parseInt(pick(n), 16);
  return Number.isNaN(parsed) ? -999999 : parsed;
}

/** Two, where most of the corpus stops at the first character. */
export function radixTwo(n: number): number {
  const parsed = parseInt(pick(n), 2);
  return Number.isNaN(parsed) ? -999999 : parsed;
}

/** Thirty-six, where every letter is a digit. */
export function radixThirtySix(n: number): number {
  const parsed = parseInt(pick(n), 36);
  return Number.isNaN(parsed) ? -999999 : parsed;
}

/** Outside 2..36, which is NaN whatever the text says. */
export function radixOutOfRange(n: number): number {
  const parsed = parseInt(pick(n), 1);
  return Number.isNaN(parsed) ? -999999 : parsed;
}

/** A computed radix, so the constant folder cannot answer for the runtime. */
export function computedRadix(n: number): number {
  const parsed = parseInt(pick(n), (n % 40) - 2);
  return Number.isNaN(parsed) ? -999999 : parsed;
}

/** `Number.parseInt`, which is the same function object in JavaScript. */
export function throughNumber(n: number): number {
  const parsed = Number.parseInt(pick(n), 16);
  return Number.isNaN(parsed) ? -999999 : parsed;
}

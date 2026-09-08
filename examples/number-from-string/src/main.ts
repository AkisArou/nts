// `Number(s)`, which the specification calls StringToNumber and which is a
// parse rather than a conversion.
//
// It is deliberately not `strtod` on the whole string. C accepts three
// spellings JavaScript does not -- `inf`, `nan`, and a hexadecimal float with a
// `p` exponent -- and JavaScript accepts three C does not: `0b`, `0o`, and a
// leading `.` with no digit before it. So the grammar is checked in the runtime
// and `strtod` is asked only about a span already decided to be decimal, where
// it is exactly right: correctly rounded, which an accumulate-and-scale loop is
// not.
//
// Two answers people are surprised by, and both are node's: `Number("")` is 0
// and `Number("  ")` is 0. And one that separates this from `parseFloat`
// entirely -- there is no prefix parse. `Number("1abc")` is NaN where
// `parseFloat("1abc")` is 1.
//
// Every case below was compared against node rather than reasoned about.

const CASES: string[] = [
  // Ordinary decimals, and the two shapes with a digit on only one side.
  "42",
  "-42",
  "+42",
  "0.1",
  ".5",
  "-.5",
  "5.",
  "0",
  "-0",
  // Exponents, both signs, and a capital.
  "1e3",
  "1E3",
  "1e-3",
  "1e+3",
  "-2.5e2",
  // Radix prefixes, which are unsigned by grammar: `-0x10` is NaN, not -16.
  "0x1f",
  "0X1F",
  "0b1011",
  "0B1011",
  "0o17",
  "0O17",
  "-0x10",
  "0x",
  "0b2",
  // Whitespace is trimmed at both ends, and an empty or all-space string is +0.
  "  7  ",
  "\t\n 8 \r",
  "",
  "   ",
  // Letters. `Infinity` is a literal; `inf` and `nan` are C's and not
  // JavaScript's.
  "Infinity",
  "-Infinity",
  "+Infinity",
  "infinity",
  "inf",
  "nan",
  "NaN",
  // Not complete literals, so NaN rather than a prefix.
  "1abc",
  "abc",
  "1 2",
  "--1",
  "1.2.3",
  ".",
  "-",
  "e5",
  "1e",
  // Past 2^53, where the answer is the rounded double.
  "9007199254740993",
  "123456789012345678901234567890",
  "1e309",
  "-1e309",
  "1e-320",
];

function at(n: number): string {
  const index = n > 0 && n < CASES.length ? n | 0 : 0;
  return CASES[index]!;
}

// NaN cannot be compared for equality, so it is reported as a sentinel the
// oracle and the compiled program both produce.
export function parsed(n: number): number {
  const value = Number(at(n));
  return Number.isNaN(value) ? -987654 : value;
}

// The sign of a zero, which `Number("-0")` has and `0` does not. Reading it
// back through division is the only way to see it.
export function signOfZero(n: number): number {
  const value = Number(at(n));
  if (value !== 0) {
    return 2;
  }
  return 1 / value === -Infinity ? -1 : 1;
}

// Infinite results, kept apart from the finite ones so a wrong answer there
// cannot hide inside a NaN sentinel.
export function isInfinite(n: number): number {
  const value = Number(at(n));
  if (value === Infinity) {
    return 1;
  }
  if (value === -Infinity) {
    return -1;
  }
  return 0;
}

// Through a `slice`, which is how the JSON scanner reaches it: the string is a
// window into a larger one rather than a literal.
export function fromASlice(n: number): number {
  const source = "  [12345]  ";
  const width = n > 0 && n < 5 ? n | 0 : 5;
  const value = Number(source.slice(3, 3 + width));
  return Number.isNaN(value) ? -987654 : value;
}

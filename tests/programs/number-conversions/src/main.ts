// Converting to and from numbers, and printing them.
//
// Written as a sweep rather than for a feature, and it found two defects that
// had nothing to do with each other:
//
// **`-"3"` negated a pointer.** Unary `-` is `ToNumeric(x)` negated, and unary
// `+` — the same conversion with nothing to do afterwards — had the coercion
// while `-` did not. The backend emitted `(double)v0` on an `NtsString *`, which
// clang rejects and `emit-c` refused nothing about. The comment beside the `+`
// case describes that exact symptom, one operator over. A `bigint` is the arm
// `ToNumeric` keeps: `-1n` stays a bigint.
//
// **`Math.trunc(n).toString(16)` emitted LLVM IR clang would not take.**
// Rounding an integer is an identity, and the LLVM backend emitted it as
// `add i32` — an identity *at the operand's type*, where the result is the
// `double` the radix helper takes. The arm directly below it in that file
// handles the mirror case and explains it: "the *result* may be an integer even
// where the operand is not". Both directions need the conversion written down;
// one had it. C needs neither, because assigning to a declared local is the
// conversion there.

export function printing(n: number): string {
  return String(n) + "|" + String(n * 0.1) + "|" + String(n / 3);
}

export function tinyAndHuge(n: number): string {
  return String(n * 1e300) + "|" + String(n * 1e-300) + "|" + String(n * 1e21);
}

/** The LLVM defect: a rounding whose result feeds a helper taking a double. */
export function radix(n: number): string {
  const i = Math.trunc(n);
  return i.toString(16) + "|" + i.toString(2) + "|" + i.toString(36);
}

/** The other rounding operators through the same path. */
export function roundedRadix(n: number): string {
  return Math.floor(n).toString(8) + "|" + Math.round(n).toString(16);
}

export function literalForms(n: number): number {
  return 0xff + 0b1010 + 0o17 + 1_000 + n;
}

/** The unary-minus defect, beside the `+` that always worked. */
export function coercions(n: number): number {
  return +"12" + -"3" + Number("4.5") + n;
}

/** A string the program computes rather than writes, so nothing folds. */
export function coercedParameter(s: string, n: number): number {
  return -s + +s + n;
}

/** `-1n` stays a bigint, which is the arm `ToNumeric` keeps. */
export function negatedBigInt(n: number): string {
  const b = BigInt(Math.trunc(n));
  return (-b).toString();
}

export function specials(n: number): string {
  return String(n / 0) + "|" + String(-n / 0) + "|" + String(0 / 0);
}

export function rounding(n: number): string {
  return String(0.1 + 0.2) + "|" + String(n + 0.1 + 0.2);
}

export function parsing(s: string): number {
  return parseFloat(s) + parseInt(s, 16);
}

/** `1 / -0` is `-Infinity`, which is how the sign of zero is observed. */
export function negativeZero(n: number): string {
  return String(1 / -(n * 0)) + "|" + String(n * -0);
}

export function bigIntegers(n: number): string {
  return String(2 ** 53) + "|" + String(2 ** 53 + n);
}

// `Number.prototype.toString(radix)`.
//
// The refusal this replaces was three calls from every module's front door:
// `ERR_INVALID_ARG_TYPE` renders the offending value into its message,
// rendering a control character means a hex escape, and `code.toString(16)` is
// that escape. So `inspectString` did not compile, so `inspectValue` did not,
// so `ERR_OUT_OF_RANGE` and `ERR_INVALID_ARG_VALUE` did not, so
// `validateInt32`, `validateInteger` and `validateNumberRange` did not -- and
// those are what node's entry points call first.
//
// The fraction is the part worth having cases for. `(0.5).toString(2)` is an
// exact `0.1`, `(0.1).toString(3)` is an infinite expansion that has to stop
// where the digits stop distinguishing this double from its neighbours, and a
// large integer has more digits than the double has bits -- so node writes
// zeros where the value cannot say anything, and inventing digits there is the
// failure this is written against.

export function inRadix(value: number, radix: number): string {
  return value.toString(radix);
}

/** The escape `inspectString` needs, which is the call site that motivated it. */
export function hexEscape(code: number): string {
  return `\\u${code.toString(16)}`;
}

/** Upper-case hex with a pad, the other spelling in the same file. */
export function twoDigitHex(code: number): string {
  const hex = code.toString(16).toUpperCase();
  return hex.length === 1 ? `0${hex}` : hex;
}

/** The control: no radix at all still means base ten. */
export function plain(value: number): string {
  return value.toString();
}

/** The second control: base ten passed explicitly is the same string. */
export function baseTen(value: number): string {
  return value.toString(10);
}

/** A negative value keeps its sign in front of the digits, not inside them. */
export function negativeInRadix(value: number, radix: number): string {
  return (-value).toString(radix);
}

/** Length rather than the text, so a difference shows up as a number too. */
export function digitCount(value: number, radix: number): number {
  return value.toString(radix).length;
}

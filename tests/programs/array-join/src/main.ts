// `join` on the three receivers, compared against node character by character.
//
// The result is a string and the differential compares scalars, so every case
// returns a checksum over the code units rather than the string itself. A
// checksum is weaker than the text and stronger than a length: it catches a
// wrong digit, a missing separator and a transposition, and it is the only
// shape this harness can carry.
//
// `String(x)` per element is what `Array.prototype.join` says, so these are
// really a test of the number formatter reached through a new caller: the
// fractions, the negatives, the exponent thresholds at 21 and -6, and the
// integer fast path that every typed-array element takes.

function checksum(text: string): number {
  let sum = 0;
  for (let index = 0; index < text.length; index++) {
    sum = (sum * 31 + text.charCodeAt(index)) % 1000000007;
  }
  return sum;
}

export function wholeNumbers(): number {
  return checksum([1, 2, 3, 42, 0, -7].join(","));
}

export function defaultSeparator(): number {
  return checksum([1, 2, 3].join());
}

export function emptySeparator(): number {
  return checksum([1, 2, 3].join(""));
}

export function longSeparator(): number {
  return checksum([1, 2, 3].join(" -- "));
}

export function singleElement(): number {
  return checksum([42].join(","));
}

export function emptyArray(): number {
  const xs: number[] = [];
  return checksum(xs.join(","));
}

// Fractions, which take the Grisu path rather than the integer one.
export function fractions(): number {
  return checksum([1.5, -2.25, 0.1, 1e21, 1e-7, 1234567.89].join(","));
}

// The two thresholds ECMAScript's Number::toString names, either side.
export function thresholds(): number {
  return checksum([1e20, 1e21, 1e-6, 1e-7].join("|"));
}

export function negativeZero(): number {
  return checksum([-0, 0, -1].join(","));
}

export function extremes(): number {
  return checksum([1.7976931348623157e308, 5e-324].join(","));
}

// A typed array, which is the receiver `internal/errors.ts:547` uses.
export function bytes(): number {
  const view = new Uint8Array(5);
  view[0] = 0;
  view[1] = 1;
  view[2] = 127;
  view[3] = 128;
  view[4] = 255;
  return checksum(view.join(", "));
}

export function bytesDefaultSeparator(): number {
  const view = new Uint8Array(3);
  view[0] = 7;
  view[1] = 8;
  view[2] = 9;
  return checksum(view.join());
}

export function emptyView(): number {
  const view = new Uint8Array(0);
  return checksum(view.join(","));
}

// A signed element type, so the sign is read from the view rather than assumed.
export function signedBytes(): number {
  const view = new Int16Array(3);
  view[0] = -32768;
  view[1] = 0;
  view[2] = 32767;
  return checksum(view.join(","));
}

// Strings, the receiver that already worked -- the control that says this
// change did not move it.
export function strings(): number {
  return checksum(["alpha", "beta", "gamma"].join(", "));
}

// # `toString` on an array **is** `join()`
//
// The specification says so in as many words: `Array.prototype.toString` calls
// the array's `join` when it is callable, which for an ordinary array it is.
// The separator is the comma `join` already defaults to, so the lowering is a
// **rename** before dispatch rather than a second implementation — one that
// could disagree with `join` about a hole, an empty array, or how a number is
// formatted.
//
// It refused as ``toString`, where an array has only `length``, which is a true
// sentence about the layout — an array has no methods in it — and a misleading
// one about the program.
//
// **It moves no corpus row, and that was worth finding out before claiming
// one.** The 7 files that surfaced behind `instanceof Array` carrying this
// message do not *call* it:
//
//     if (array.toString !== Array.prototype.toString) { … }
//
// They read `toString` as a **value** and compare it with the one on
// `Array.prototype`, which needs function identity for a prototype method and
// is a much larger thing. This is the method every other program calls, and
// that is the whole of its case.
//
// Only with **no arguments**. `Array.prototype.toString` takes none, and a call
// that passes one is something else, most likely a method on a subclass, which
// keeps its own refusal rather than being silently reinterpreted.

export function numbersToString(): number {
  return checksum([1, 2, 3].toString());
}

export function stringsToString(): number {
  return checksum(["alpha", "beta"].toString());
}

/** Empty is `""`, which `join` already answers and this must not differ on. */
export function emptyToString(): number {
  const xs: number[] = [];
  return checksum(xs.toString());
}

/** One element has no separator in it at all. */
export function singleToString(): number {
  return checksum([7].toString());
}

/**
 * The control: `join` with a separator still takes it. A rename that dropped
 * the arguments would pass every arm above and lose this one.
 */
export function joinStillTakesASeparator(): number {
  return checksum([1, 2, 3].join("-"));
}

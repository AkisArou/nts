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

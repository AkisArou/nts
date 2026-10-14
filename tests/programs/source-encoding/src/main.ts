// A source file that is not ASCII, which every other example here is.
//
// A TypeScript node's `pos` and `end` count UTF-16 code units, because that is
// what an index into a JavaScript string is. The payload carries UTF-8. For
// ASCII the two numbers are equal, so slicing the payload with them was right
// for every file this compiler had ever been given — and wrong for this one.
//
// The failure is silent and it is a *miscompilation*: a numeric literal takes
// its value from its own source text, so a drifted span reads a different
// literal, and the program computes a different number. It was found by an
// example whose comments happened to contain em dashes, where `? 10 : 0`
// compiled to `? 10 : 2` — the `2` belonging to an `n + 2` ten bytes earlier,
// which is two bytes for each of the five em dashes above it.
//
// Every function below returns a value that depends on a literal appearing
// after a multi-byte character. Three widths are covered, because they drift
// by different amounts: é is two UTF-8 bytes and one UTF-16 unit, — is three
// and one, and an astral character is four bytes and *two* units — the case
// where UTF-16 is not one unit per character either.

// Drift of one byte per character: café is four characters and five bytes.
export function afterTwoByte(n: number): number {
  const label = "café";
  return label.length * 1000 + (n > 0 ? 10 : 0) + 7;
}

// Three bytes, one unit: two bytes of drift each.
export function afterThreeByte(n: number): number {
  // — — — three of them, six bytes of drift by the time the literals below are read
  return (n > 1 ? 100 : 0) + (n > 2 ? 20 : 0) + 3;
}

// Four bytes, two units: a surrogate pair, where a byte offset and a UTF-16
// offset disagree in both directions at once.
export function afterAstral(n: number): number {
  const rocket = "🚀";
  return rocket.length * 10000 + (n > 0 ? 500 : 0) + 42;
}

// Literals of several shapes after the drift, since each is parsed from its own
// text: a decimal, a hexadecimal, an exponent and a fraction.
export function shapesAfterDrift(n: number): number {
  // ¡Cuidado! — mixed widths above this line
  const dec = 250;
  const hex = 0xff;
  const exp = 2e3;
  const frac = 0.5;
  return dec + hex + exp + frac * n;
}

// A non-ASCII *identifier*, which is legal TypeScript and moves the spans of
// everything after it.
export function afterIdentifier(n: number): number {
  const café = 12;
  const naïve = 30;
  return café * 100 + naïve + (n > 0 ? 9 : 0);
}

// The original shape, reduced: a literal inside a condition and a zero after it.
export function conditionThenZero(n: number): number {
  // — one em dash is enough to shift what follows
  return (n + 2 > 3 ? 10 : 0) + (n + 99 > 100 ? 1 : 0);
}

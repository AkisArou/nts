// A literal is immutable and known at compile time, so it is static data rather
// than an allocation. Only concatenation allocates.
//
// Strings are UTF-16 code units, which is what JavaScript means by one:
// `length` counts them. Stored one byte per unit when every unit fits in one,
// two bytes otherwise -- so `length` is O(1) for all of JavaScript while
// ordinary text still costs one byte per character.

export function greetingLength(): number {
  return ("hello " + "world").length;
}

export function emptyLength(): number {
  return "".length;
}

// Equality is by value: these are two different allocations holding the same
// code units.
export function concatEqualsLiteral(): boolean {
  return "ab" === "a" + "b";
}

// Through a call, because TypeScript rejects `"ab" === "ba"` outright: it can
// see the two literal types are disjoint. Widening to `string` is what makes it
// a runtime question, which is the one being tested.
function widen(s: string): string {
  return s;
}

export function differs(): boolean {
  return widen("ab") === widen("ba");
}

export function sameLength(): boolean {
  return widen("ab") === widen("ab");
}

// Beyond Latin-1, so this one is stored two bytes per unit. `length` still
// counts code units.
export function wideLength(): number {
  return "λόγος".length;
}

// One narrow and one wide operand: the result has to be wide, and comparing
// them must not depend on how either was stored.
export function mixedLength(): number {
  return ("id:" + "λόγος").length;
}

export function mixedEquals(): boolean {
  return "id:λ" === "id:" + "λ";
}

export function sizeOf(s: string): number {
  return s.length;
}

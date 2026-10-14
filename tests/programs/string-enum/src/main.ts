// A string enum member, which is a constant like a numeric one and a *managed*
// constant rather than an immediate.
//
// The checker gives `Label.Short` the same `Literal(String("s"))` type it gives
// the literal `"s"`, so this is the interned static a literal already gets --
// the two share one, rather than each getting its own.

enum Label {
  Short = "s",
  Long = "long",
  Empty = "",
}

const enum Direction {
  Up = "up",
  Down = "down",
}

// A member whose value is another member's, which TypeScript allows and which
// folds to the same constant rather than to a reference.
enum Alias {
  First = "one",
  Same = First,
}

export function pick(n: number): string {
  return n > 0 ? Label.Short : Label.Long;
}

// The empty string is the one whose length is zero and which is falsy, so a
// lowering that confused "no constant" with "the empty constant" shows here.
export function empty(n: number): string {
  return n > 3 ? Label.Empty : Label.Short;
}

export function emptyLength(n: number): number {
  const chosen = n > 3 ? Label.Empty : Label.Long;
  return chosen.length * 10 + (chosen ? 1 : 0);
}

// Compared for equality, which is what a string enum is usually for.
export function classify(n: number): number {
  const chosen = n > 0 ? Label.Short : Label.Long;
  if (chosen === Label.Short) {
    return 1;
  }
  if (chosen === Label.Long) {
    return 2;
  }
  return 3;
}

// Concatenated, so the constant reaches the string builder rather than only a
// comparison.
export function describe(n: number): string {
  return "<" + (n > 0 ? Label.Short : Label.Long) + ">";
}

// In a template, which is a different lowering from `+`.
export function interpolated(n: number): string {
  const chosen = n > 0 ? Label.Short : Label.Empty;
  return `[${chosen}:${n > 0 ? 1 : 0}]`;
}

// A `const enum`, whose members have no run-time object at all -- the erasure
// TypeScript itself performs is exactly this substitution.
export function heading(n: number): string {
  return n > 0 ? Direction.Up : Direction.Down;
}

export function headingLength(n: number): number {
  return (n > 0 ? Direction.Up : Direction.Down).length;
}

// A member defined as another member.
export function aliased(n: number): number {
  const a = n > 0 ? Alias.First : Alias.Same;
  return a === Alias.First ? a.length : -1;
}

// Through a function boundary, so the constant is an argument rather than a
// value in one body.
function widthOf(text: string): number {
  return text.length;
}

export function throughACall(n: number): number {
  return widthOf(n > 0 ? Label.Long : Label.Short);
}

// Stored in a field and read back, so it crosses an object.
class Tagged {
  tag: string;
  constructor(tag: string) {
    this.tag = tag;
  }
}

export function throughAField(n: number): number {
  const held = new Tagged(n > 0 ? Label.Long : Label.Short);
  return held.tag === Label.Long ? 100 : 200;
}

// In an array, and looked up by index.
export function inAnArray(n: number): string {
  const all = [Label.Short, Label.Long, Label.Empty];
  const at = n > 0 ? 0 : 1;
  return all[at] + "|" + all.length;
}

// A `switch` over one, which lowers to a chain of comparisons on managed
// values rather than on immediates.
export function branch(n: number): number {
  const chosen = n > 2 ? Label.Long : n > 0 ? Label.Short : Label.Empty;
  switch (chosen) {
    case Label.Short:
      return 11;
    case Label.Long:
      return 22;
    default:
      return 33;
  }
}

// Beside a numeric enum, so nothing about this changes the other.
enum Colour {
  Red = 1,
  Green = 2,
}

export function both(n: number): string {
  const c = n > 0 ? Colour.Red : Colour.Green;
  const l = n > 0 ? Label.Short : Label.Long;
  return l + ":" + c;
}

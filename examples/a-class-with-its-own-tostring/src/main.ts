// `${o}`, `"" + o` and `String(o)` where `o`'s class declares `toString`.
//
// All three convert through it -- `ToPrimitive` with hint string calls it -- so
// the *receiver's class* decides what the conversion means and the conversion is
// a call. The lowering had an arm for every conversion whose answer is fixed by
// the source type: a number, a boolean, a bigint, a symbol, a string. An object
// was the one whose answer the program writes, and it fell to
// `a conversion to string from `A``.
//
// **A class with no `toString` still refuses, deliberately.** The answer there is
// `"[object Object]"`, a constant this could emit in one line -- and then every
// `${o}` that meant something would print the same eight characters instead of
// naming the method the program is missing. A wrong answer that looks like an
// answer is worse than a refusal, and this is the cheapest possible instance of
// it. `blockers/a-tostring-nobody-declared` holds the case.

class Point {
  x: number;
  y: number;

  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }

  toString(): string {
    return "(" + this.x.toString() + "," + this.y.toString() + ")";
  }
}

// An override, reached through the base type so the call has to dispatch rather
// than resolve. `super.toString()` inside it is the same method one level up.
class Labelled extends Point {
  label: string;

  constructor(x: number, y: number, label: string) {
    super(x, y);
    this.label = label;
  }

  toString(): string {
    return this.label + super.toString();
  }
}

export function inATemplate(n: number): string {
  return `p=${new Point(n, n + 1)}`;
}

export function concatenated(n: number): string {
  return "p=" + new Point(n, n + 1);
}

export function viaStringCall(n: number): string {
  return String(new Point(n, n + 1));
}

// Declared as the base, holding the subclass: the conversion must find
// `Labelled`'s method and not `Point`'s.
export function overridden(n: number): string {
  const p: Point = new Labelled(n, n + 1, "L");
  return `${p}`;
}

// Two conversions of two different objects in one expression, so a lowering
// that cached the callee would show it in the value.
export function twoObjects(n: number): string {
  const a = new Point(n, 0);
  const b = new Labelled(0, n, "B");
  return `${a}|${b}`;
}

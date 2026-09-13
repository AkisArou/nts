// expect: a relational comparison between objects, which is `ToPrimitive` on each
//
// `a > b` where both are class instances is `ToPrimitive` on each — `valueOf`
// first for a relational comparison, then `toString` — and this compiler has
// neither.
//
// **It was a wrong answer that ran, not a refusal.** What it emitted was
// `gt %1, %7` on two `object.new` pointers, so `a > b` was **true for every
// input** where node answers from the degrees: 29 of 29 cases disagreed.
//
// # Why this one and not the rest of `ToPrimitive`
//
// TypeScript rejects most of the family before it reaches the compiler:
//
//     o + 1        TS2365  Operator '+' cannot be applied to these types
//     "1" == 1     TS2367  This comparison appears to be unintentional
//     `${o}`               refused — a conversion to string from `Celsius`
//     Number(o)            refused — a conversion to number from this type
//
// **`>` between two objects is not a type error**, so it is one of the few
// `ToPrimitive` shapes a checking program can write, and it was the only one
// that was not already refused. That is why the row it belongs to had nothing
// in it: the family reads as unreachable until you write the one member that
// is reachable.
//
// # What closing it needs
//
// `OrdinaryToPrimitive` with hint `number`: call `valueOf`, take the result if
// it is a primitive, otherwise call `toString`, and throw `TypeError` if
// neither is. That is a dispatch on a member this compiler does put on the
// descriptor, so it is reachable machinery rather than missing machinery — what
// it needs is the *ordering* and the fallback, which nothing here expresses.
//
// Zero corpus demand: `runtime/node` writes no relational comparison between
// objects.

class Celsius {
  degrees: number;
  constructor(d: number) {
    this.degrees = d;
  }
  valueOf(): number {
    return this.degrees;
  }
}

/** Under test. Answered `true` for every input before it was refused. */
export function objectsRelational(n: number): number {
  const a = new Celsius(n & 7);
  return (a > new Celsius(3) ? 1 : 0) + 1;
}

/** Control: numbers compare, and always did. */
export function numbers(n: number): number {
  return ((n & 7) > 3 ? 10 : 0) + ((n & 7) <= 3 ? 1 : 0);
}

/** Control: strings compare, and always did. */
export function strings(n: number): number {
  const s = (n & 1) === 0 ? "a" : "z";
  return (s < "m" ? 10 : 0) + (s >= "a" ? 1 : 0);
}

/** Control: the same comparison written through the member it would call. */
export function explicitValueOf(n: number): number {
  const a = new Celsius(n & 7);
  return (a.degrees > 3 ? 10 : 0) + 1;
}

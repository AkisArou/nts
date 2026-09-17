// `const k = "step"` and then `{ [k]: 4 }` or `class A { [k]() { … } }`.
//
// Refused as `a computed property name` and `a member whose name the program
// computes`, which is the one thing the program does not do. **`const k =
// "step"` is typed `"step"`, not `string`** -- so `[k]` names exactly one
// property, the checker has already said which, and the brackets suggest a
// decision at run time that nothing makes.
//
// `literal_name` already answered `["step"]` written out, by reading the
// literal's type when the decoder carries no text. The `const` case is the same
// question one indirection away and reached the same place with the same answer
// available, so the arm that handles a literal child now has a sibling that
// handles a child whose *type* is one. `symbol_member_name` states the
// observation for `[Symbol.iterator]`: not a name the program decides at run
// time, "however much the brackets suggest it".
//
// `widenedKey` is the arm that keeps this honest. Annotating the constant --
// `const w: string = "step"` -- widens its type, this stops answering, and
// TypeScript stops resolving `o[w]` to a single member too. It is included
// because it lowers by a different route and had to keep doing so.

const key = "step";
const second = "other";
const index = 2;
const widened: string = "step";

class Machine {
  count = 0;

  [key](): number {
    this.count += 1;
    return this.count;
  }

  [index](): number {
    return 90;
  }
}

/** A data property, read back through the dot. */
export function dataByDot(n: number): number {
  const o = { [key]: 4 };
  return o.step + n;
}

/** …and read back through the same constant, which has to resolve to the member
 *  the write created. */
export function dataByTheSameConstant(n: number): number {
  const o = { [key]: 4, [second]: 1 };
  return o[key] * 10 + o[second] + n;
}

/** A numeric constant, whose property name is its digits. */
export function numericKey(n: number): number {
  const o = { [index]: 7 };
  return o[2] + n;
}

/** A method on a class, called by its written name. */
export function methodByName(n: number): number {
  return new Machine()[key]() + n;
}

/** The same method, called through the constant, with state so that two calls
 *  answer differently -- a lowering that emitted two functions would not. */
export function methodTwice(n: number): number {
  const m = new Machine();
  return m[key]() * 100 + m.step() * 10 + n;
}

/** A numerically keyed method. */
export function numericMethod(n: number): number {
  return new Machine()[index]() + n;
}

/** The widened annotation, which is not a constant name and never was. */
export function widenedKey(n: number): number {
  const o = { [widened]: 4 };
  return o[widened] + n;
}

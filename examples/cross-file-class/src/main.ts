import { readCount } from "./helper.js";
import { Base, Counter } from "./provider.js";

export function counts(n: number): number {
  const c = new Counter(n);
  return c.bump(2) * 10 + c.tag();
}

export function throughTheGetter(n: number): number {
  const c = new Counter(n);
  c.bump(1);
  return c.current;
}

export function throughTheCycle(n: number): number {
  const c = new Counter(n);
  c.bump(3);
  return readCount(c);
}

// `instanceof` against an **imported** class.
//
// A reference to an imported name resolves to a symbol declared at the *import
// site*, and the class's type is filed under the declaration's. Searching the
// type table for the alias's symbol found nothing, and the refusal said "an
// `instanceof` against something this compiler has no class for" — of a class it
// had laid out, in a file it had compiled, one import away.
//
// `chunk instanceof Buffer` in `net`, where `Buffer` is `buffer`'s class, is the
// shape it was found in: 18 sites in `runtime/node`, none of them a construct
// this compiler lacks.
export function isACounter(n: number): number {
  const v: unknown = n > 0 ? new Counter(n) : "not one";
  return v instanceof Counter ? 1 : 0;
}

// The base, imported from the same file, so the subclass answers yes to it.
// This is what distinguishes following the alias from merely finding *a* type
// with that name: `Counter` and `Base` are two symbols in one module, and the
// hierarchy has to relate them after the hop.
export function isABase(n: number): number {
  const v: unknown = n > 0 ? new Counter(n) : new Base();
  return v instanceof Base ? 1 : 0;
}

// And the negative, so the pair cannot pass by answering yes to everything.
export function baseIsNotACounter(n: number): number {
  const v: unknown = n > 0 ? new Base() : new Counter(n);
  return v instanceof Counter ? 1 : 0;
}

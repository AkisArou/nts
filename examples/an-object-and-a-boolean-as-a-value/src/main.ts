// `obj && flag` and `obj || fallback` read as values, where `obj` is an object
// type that excludes `null` and `undefined`: an object is always truthy, so the
// first is `flag` and the second is `obj`, with `obj` still evaluated. Lowered
// by branching, the false arm was the object read as the expression's type,
// and refused as "an object where a boolean is wanted"; the condition form
// (`examples/an-object-in-a-boolean-context`) branched on truthiness and never
// built that arm.
//
// Decided from the **declared** type of what is read -- a field's, a
// binding's -- never the narrowed one: a `Proto | null` the checker narrowed to
// `Proto` is stale where a closure assigns it, and stays a test at run time.

class Proto {
  readonly isPure: boolean;
  constructor(isPure: boolean) {
    this.isPure = isPure;
  }
}

class Type {
  readonly prototype: Proto;
  constructor(isPure: boolean) {
    this.prototype = new Proto(isPure);
  }
}

/** A field read: `type.prototype && type.prototype.isPure`. */
export function andAsAValue(n: number): boolean {
  const type = new Type((n & 1) === 1);
  return type.prototype && type.prototype.isPure;
}

/** A `new`, evaluated for its effects, and the right operand's answer. */
export function andOnANew(n: number): string {
  let made = 0;
  const make = (): Proto => {
    made += 1;
    return new Proto((n & 2) === 2);
  };
  const answer = make() && (n & 1) === 0;
  return String(answer) + String(made);
}

/** `||` answers the object itself. */
export function orAsAValue(n: number): boolean {
  const type = new Type((n & 1) === 1);
  const chosen = type.prototype || new Proto(false);
  return chosen.isPure;
}

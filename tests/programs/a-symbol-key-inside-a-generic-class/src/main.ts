// A `unique symbol` key reaching a field of the class it is written in, where
// that class is **generic**.
//
// The same member, reached two ways, and only one of them needed a
// representation. `this.count` never consults the receiver's lowered type; a
// computed `this[kCount]` did, and in a generic class there is nothing there to
// find: TypeScript models `this` as a type parameter constrained to its own
// class, and for a generic class that constraint is the *uninstantiated* form,
// which `tsgo::decompose` leaves as a `Structured` placeholder. The stated
// ground for the placeholder -- "only instantiations are ever lowered, so the
// members of a form parameterised by one are members nothing can use" -- is
// true of a generic function and false of a method reaching its own field.
//
// It refused as `indexing `this`, which stands for `Holder` here, which is not
// an array`, which was the **largest single refusal text in the corpus**: 299
// sites, 89 of them across five modules measured either side of the fix.
//
// The non-generic class is here as the arm that always worked, so a change that
// broke it would show.

const kCount: unique symbol = Symbol("count");
const kLabel: unique symbol = Symbol("label");

class Generic<T> {
  [kCount] = 0;
  [kLabel] = "g";
  plain = 0;

  /** `T` in a parameter only, so nothing here is about representing it. */
  accept(value: T): number {
    this.plain += 1;
    return this.plain;
  }

  /** Read, written, and compound-assigned through the symbol key. */
  bump(by: number): number {
    this[kCount] += by;
    return this[kCount];
  }

  labelled(): number {
    return this[kLabel].length + this[kCount];
  }
}

class Plain {
  [kCount] = 0;
  bump(by: number): number {
    this[kCount] += by;
    return this[kCount];
  }
}

export function throughAGenericClass(n: number): number {
  const h = new Generic<number>();
  h.accept(n & 7);
  h.bump(n & 15);
  return h.bump(1) + h.labelled();
}

export function fromOutsideTheClass(n: number): number {
  const h = new Generic<number>();
  h.bump(n & 31);
  return h[kCount] + h[kLabel].length;
}

export function theNonGenericArm(n: number): number {
  const p = new Plain();
  p.bump(n & 63);
  return p.bump(2);
}

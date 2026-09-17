// `{ v: 1, twice() { return this.v * 2 } }` — a method, a getter or a setter
// written in an object literal.
//
// A class's members were lowered and a literal's were not: `lower_class` walks
// declarations, and an object literal is an expression whose type the checker
// *makes*. So three things had to meet.
//
// **The type it is lowered under is the type it is built at.** An
// `{ v, twice() {} }` assigned to an `interface O` lowered its method as
// `Type6#twice` while the call asked for `O#twice`, because one side took the
// literal's own checker type and the other the contextual one. `lower_object_literal`
// and the member lowering now read the same answer from `literal_object_type`.
//
// **The hierarchy learns from the *type*, not from the literal node.**
// `const o = { v, twice() {} }` gives the literal expression one anonymous type
// and widens `o` to another; a walk over nodes registers the first and the call
// site asks about the second. Every anonymous object type carrying a member is
// registered, so which one a site holds stops mattering.
//
// **And `__object` is a name that is not one.** TypeScript gives every object
// type a symbol and calls the ones with no declaration `__object`, so the two
// literals below — each declaring `twice` — both produced `__object#twice` and
// lowering refused the program with `DuplicateFunction`. `decompose.rs` already
// declines to publish those as nominal identities, for exactly the reason it
// states; this applies the same rule where a layout is named. `sameNameTwice`
// is the arm that holds it.

/** A method, reading `this`. */
export function method(n: number): number {
  const o = {
    v: n,
    twice(): number {
      return this.v * 2;
    },
  };
  return o.twice();
}

/** A getter, which is a call that looks like a load. */
export function getter(n: number): number {
  const o = {
    v: n,
    get twice(): number {
      return this.v * 2;
    },
  };
  return o.twice;
}

/** A setter. */
export function setter(n: number): number {
  const o = {
    v: 0,
    set doubled(x: number) {
      this.v = x * 2;
    },
  };
  o.doubled = n;
  return o.v;
}

/** Both on one name, so the `get `/`set ` keys have to stay apart. */
export function both(n: number): number {
  const o = {
    v: 0,
    get half(): number {
      return this.v / 2;
    },
    set half(x: number) {
      this.v = x * 2;
    },
  };
  o.half = n;
  return o.half;
}

/** One member calling another through `this`. */
export function chained(n: number): number {
  const o = {
    v: n,
    twice(): number {
      return this.v * 2;
    },
    quad(): number {
      return this.twice() * 2;
    },
  };
  return o.quad();
}

/** **Two literals, one member name.** Both were `__object#twice` before the
 *  layouts were named apart, and the program was refused as a duplicate. The
 *  two answer differently so a collision that merged them would show in the
 *  value as well as in the count. */
export function sameNameTwice(n: number): number {
  const a = {
    v: n,
    twice(): number {
      return this.v * 2;
    },
  };
  const b = {
    w: n,
    twice(): number {
      return this.w * 3;
    },
  };
  return a.twice() * 100 + b.twice();
}

/** Contextually typed by an interface, which is the other type the member could
 *  have been lowered under. */
interface Doubler {
  v: number;
  twice(): number;
}

export function annotated(n: number): number {
  const o: Doubler = {
    v: n,
    twice(): number {
      return this.v * 2;
    },
  };
  return o.twice();
}

/** A literal with no members at all, which has to keep working. */
export function plain(n: number): number {
  const o = { v: n, w: 2 };
  return o.v + o.w;
}

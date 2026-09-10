// A generic free function called with `this`.
//
//     function addListener<T extends EventEmitter>(target: T, ...): T
//     ...
//     on(type, listener) { return addListener(this, type, ...); }
//
// node's `events` module is written this way, and `on`, `addListener` and
// `prependListener` all call the helper with `this`. All three were dropped —
// and `EventEmitter#on` is the base of `net.Server`, `http.Server`, every
// stream, `process`, `readline` and `dgram`.
//
// # It was refused with no diagnostic anywhere
//
// The only sign was a cascade:
//
//     NTS1003 `EventEmitter#on` cannot be compiled because it calls
//             `addListener`, which was refused above
//
// with **no refusal above**, and no function named `addListener` in the dump at
// all. `0 function(s), 2 construct(s) refused` on the fifteen-line reduction:
// the two are the cascade, and the thing they blame emitted nothing.
//
// # The cause, which the type table gives away
//
//     #8 `T`       TypeParameter { constraint: Some(TypeId(1)) }
//     #6 `Emitter` TypeParameter { constraint: Some(TypeId(1)) }
//
// **The polymorphic `this` type is a type parameter**, spelled by the checker as
// one named after the class with the class as its constraint. So `addTo(this)`
// instantiates `T` to *another parameter*, and `unify` refused to bind one
// parameter to another — right for a genuinely unbound one, wrong for this.
// Nothing was inserted, `T` was never pinned, and the call was skipped by a
// `continue` that says nothing.
//
// Resolving through the constraint is what the run time already does: `this`
// inside `C` is "the receiver's class, which is `C` or a subclass", and
// base-first layout makes a derived pointer valid wherever a `C *` is wanted.
// One copy over `C` serves every subclass, which is exactly what node's single
// JavaScript function does.
//
// # What it did not do
//
// **It moves no count in the corpus yet**, and saying so is the honest report:
// `http`'s cascade went 892 to 895 and its surviving function count did not
// change. What it bought is that the chain is now *visible* —
// `addListener<obj6675>` exists and names its own next obstacle, which is
// `warnMaxListenersExceeded` and then `String(type)` on a `string | symbol`.
// A silent skip became a named cascade.
//
// # Controls
//
// `viaLocal` assigns `this` to a typed local first, which is the spelling that
// always worked and is what says the trigger is the argument's *type* rather
// than the generic. `viaSubclass` calls it on a derived instance, which is the
// case the constraint substitution has to be sound for. `viaConcrete` never
// mentions `this` at all.

class Emitter {
  count = 0;
  read(): number {
    return this.count;
  }
  /** `this` argument, `this` return type. */
  bumpPolymorphic(by: number): this {
    return addTo(this, by);
  }
  /** `this` argument, concrete return type. */
  bumpConcrete(by: number): Emitter {
    return addTo(this, by);
  }
  /** `this` argument to a generic returning nothing. */
  bumpVoid(by: number): void {
    addVoid(this, by);
  }
  /** Control: through a typed local, which always worked. */
  bumpViaLocal(by: number): Emitter {
    const self: Emitter = this;
    return addTo(self, by);
  }
}

class Derived extends Emitter {
  extra = 5;
}

function addTo<T extends Emitter>(target: T, by: number): T {
  target.count += by;
  return target;
}

function addVoid<T extends Emitter>(target: T, by: number): void {
  target.count += by;
}

export function polymorphic(n: number): number {
  return new Emitter().bumpPolymorphic(n).read();
}

export function concrete(n: number): number {
  return new Emitter().bumpConcrete(n).read();
}

export function returningVoid(n: number): number {
  const e = new Emitter();
  e.bumpVoid(n);
  return e.read();
}

/** Control: the local-first spelling. */
export function viaLocal(n: number): number {
  return new Emitter().bumpViaLocal(n).read();
}

/** Control: a subclass, which the constraint substitution has to be sound for. */
export function viaSubclass(n: number): number {
  const d = new Derived();
  d.bumpPolymorphic(n);
  return d.read() + d.extra;
}

/** Control: a generic call with no `this` in it. */
export function viaConcrete(n: number): number {
  const e = new Emitter();
  return addTo(e, n).read();
}

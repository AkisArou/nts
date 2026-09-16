// `o.m?.()` where `m` is an **optional method** on `o`'s type.
//
// Refused as `` `uncork`, declared by `C` with a type that has no
// representation (a union of a function type | undefined) `` -- 34 distinct
// sites, every one this shape: `previous.uncork?.()`,
// `socket.setKeepAlive?.(true, ms)`, `this.socket?.setNoDelay?.(enable)`.
//
// Only one of the four spellings was refused, which is what located it:
//
//     uncork(): void        required method    compiled
//     uncork?: () => void   optional property  compiled
//     uncork?(): void       optional method    refused
//
// A method gets a vtable entry rather than a field, so the optional call
// lowered its callee as a *value* and found no slot. But presence of an
// optional method varies per **class**, not per instance -- which is what `in`
// already answers, and `if ("uncork" in c) { c.uncork(); }` compiled all along.
// So it is that, desugared.
//
// **Both arms have to run for this fixture to mean anything**: a class test
// stuck at `true` calls a method that is not there, and one stuck at `false`
// silently skips a call that should have happened. `n & 1` picks between them
// and `seen` reports which ran.

// **An abstract class rather than an interface, and the reason is not this
// subject.** Written with `interface Corkable` first, this agreed with node
// through C and threw `ClassCastException: Full cannot be cast to Corkable`
// through the JVM -- and so does a *required* method through an interface, with
// no `?.` anywhere, which is what separated the two. The JVM backend does not
// emit the `implements` relationship, so a call through an interface-typed
// receiver casts and fails; an abstract-class receiver works on both. That is a
// backend gap of its own and it is recorded where it belongs rather than left
// to fail here, because a fixture that fails for something other than its
// subject attributes the failure to the wrong change.
abstract class Corkable {
  seen = 0;
  uncork?(): void;
  note?(by: number): void;
}

class Full extends Corkable {
  uncork(): void {
    this.seen += 1;
  }
  note(by: number): void {
    this.seen += by;
  }
}

class Bare extends Corkable {
  override seen = 100;
}

/** Present on one class, absent on the other. */
export function calledOrSkipped(n: number): number {
  const c: Corkable = (n & 1) === 0 ? new Full() : new Bare();
  c.uncork?.();
  return c.seen;
}

/** With an argument, so the call is not the zero-arity special case. */
export function withAnArgument(n: number): number {
  const c: Corkable = (n & 2) === 0 ? new Full() : new Bare();
  c.note?.(n & 7);
  return c.seen;
}

/** Twice through the same receiver, so a skipped call cannot hide behind one
 *  that ran. */
export function twice(n: number): number {
  const c: Corkable = (n & 4) === 0 ? new Full() : new Bare();
  c.uncork?.();
  c.uncork?.();
  return c.seen;
}

/** The result of an optional call on a `void` method is `undefined` either
 *  way -- it cannot report whether it ran. */
export function whatItReturns(n: number): number {
  const c: Corkable = (n & 8) === 0 ? new Full() : new Bare();
  const r = c.uncork?.();
  return (r === undefined ? 1 : 0) * 1000 + c.seen;
}

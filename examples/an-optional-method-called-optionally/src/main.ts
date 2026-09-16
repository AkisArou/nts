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

// ## Doubly optional: `this.socket?.cork?.()`
//
// The receiver is optional *and* the method is. This was the remainder after
// the singly-optional case landed, and it was described as "the two optional
// tests compose rather than nest". They do better than compose: there is still
// **one** test.
//
// Both absences produce `undefined`, and the class test already answers for
// both — an absent receiver is an instance of no class, so the arm that calls
// is exactly the arm where the receiver is present *and* its class has the
// slot. What the second `?.` adds is not a second branch but a **narrowing**:
// the receiver arrives erased, and the calling arm has to read the payload back
// out of the tag before it can dispatch. `present_of` does that, and a
// singly-optional receiver gives it nothing to do.
//
// Held in a field rather than produced by a ternary, because a ternary over
// `Corkable | undefined` erases at the assignment and refuses for a reason that
// is not this one.
class Holder {
  socket: Corkable | undefined = undefined;

  poke(): void {
    this.socket?.uncork?.();
  }

  nudge(by: number): void {
    this.socket?.note?.(by);
  }
}

/** Three states, not two: no receiver, a receiver with the slot, one without. */
export function doublyOptional(n: number): number {
  const h = new Holder();
  if ((n & 2) !== 0) {
    h.socket = (n & 1) === 0 ? new Full() : new Bare();
  }
  h.poke();
  const s = h.socket;
  return s === undefined ? -1 : s.seen;
}

/** The same three states with an argument, so the arity path is covered too. */
export function doublyWithAnArgument(n: number): number {
  const h = new Holder();
  if ((n & 4) !== 0) {
    h.socket = (n & 1) === 0 ? new Full() : new Bare();
  }
  h.nudge(n & 7);
  const s = h.socket;
  return s === undefined ? -1 : s.seen;
}

/** Twice, so a receiver read that consumed its own absence would show. */
export function doublyTwice(n: number): number {
  const h = new Holder();
  if ((n & 8) !== 0) {
    h.socket = (n & 1) === 0 ? new Full() : new Bare();
  }
  h.poke();
  h.poke();
  const s = h.socket;
  return s === undefined ? -1 : s.seen;
}

// ## The presence test, which is what the corpus actually writes
//
// The ledger recorded the remainder after the call form as doubly-optional
// calls. That was measured by reading and it was wrong. With both call forms
// lowering, **21 distinct sites** remained across `stream`, `http`, `net` and
// `fs` and **not one of them was a call**. Nineteen were this:
//
//     if (writer.writeSync !== undefined) { writer.writeSync(n); }
//
// Which is the same question `w.writeSync?.()` asks, spelled as a test and a
// call rather than as one operator, and the same question `"writeSync" in w`
// already answered. Presence of an optional method varies per **class**, so it
// is one descriptor comparison either way. Lowering the member read instead
// asks for a slot a method does not have, and refuses with ``a union of a
// function type | undefined`` — a layout question wearing a representation
// sentence, which is the same misattribution the call form had.
//
// The narrowing is the half a returned value could hide: inside the arm, the
// call has to actually happen. `Full.seen` starts at 0 and `note` adds, so a
// skipped call answers 0 where a taken one answers `by` — different for every
// `by` but zero, and the cases below span more than one.

/** `!== undefined`, then the call in the arm it guards. */
export function presentThenCalled(n: number): number {
  const c: Corkable = (n & 1) === 0 ? new Full() : new Bare();
  if (c.note !== undefined) {
    c.note(n & 7);
  }
  return c.seen;
}

/** `=== undefined` and an early return, which is the same test read the other
 *  way and the spelling `destroy.ts` uses. */
export function absentThenReturns(n: number): number {
  const c: Corkable = (n & 2) === 0 ? new Full() : new Bare();
  if (c.note === undefined) {
    return -1;
  }
  c.note(n & 7);
  return c.seen;
}

/** The test as a value rather than a condition, so nothing depends on it
 *  being consumed by an `if`. */
export function testedAsAValue(n: number): boolean {
  const c: Corkable = (n & 4) === 0 ? new Full() : new Bare();
  return c.uncork !== undefined;
}

// ## `typeof o.m === "function"`, the second spelling of the same test
//
// Six of the nineteen presence tests are written this way — `destroy.ts` alone
// has four — and it is the same question again: a method that is there is a
// function and one that is not is `undefined`, so the answer is the class test
// and neither operand needs to exist.
//
// Four comparisons map to it, and they are not symmetric in the obvious way:
// `=== "function"` and `!== "undefined"` both ask for *present*, the other two
// for absent. `typeof o.m === "object"` and the rest are constantly false for a
// method and are deliberately **not** folded here — answering them would be
// answering a question this was not asked.
//
// The literal's value is read off its type, which is where a string literal's
// value lives. Reading `node.text` instead matched nothing and left every site
// refused exactly as before, with no sign that a new path had been added.

/** `=== "function"`, and the call in the arm it guards. */
export function typeofFunction(n: number): number {
  const c: Corkable = (n & 1) === 0 ? new Full() : new Bare();
  if (typeof c.note === "function") {
    c.note(n & 7);
  }
  return c.seen;
}

/** `!== "function"` with an early return, which is `destroy.ts`'s spelling. */
export function typeofNotFunction(n: number): number {
  const c: Corkable = (n & 2) === 0 ? new Full() : new Bare();
  if (typeof c.note !== "function") {
    return -1;
  }
  c.note(n & 7);
  return c.seen;
}

/** `=== "undefined"`, which asks for absent through the same operator. */
export function typeofUndefined(n: number): number {
  const c: Corkable = (n & 4) === 0 ? new Full() : new Bare();
  if (typeof c.note === "undefined") {
    return -2;
  }
  c.note(n & 7);
  return c.seen;
}

/** The literal on the left, because a comparison has two orders and only one
 *  of them is the one anybody writes. */
export function typeofReversed(n: number): number {
  const c: Corkable = (n & 8) === 0 ? new Full() : new Bare();
  if ("function" === typeof c.uncork) {
    c.uncork();
  }
  return c.seen;
}

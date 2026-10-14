// Passing a class where a **structural interface** is wanted, when the two do
// not agree about where the shared field is.
//
//     class Thing  { id: number; name: string }   name at offset 32
//     interface Named { name: string }            name at offset 24
//     function readName(v: Named) { return v.name.length }
//     readName(new Thing(1))
//
// A compiled reference is a pointer, so this is a pointer cast, and it is only
// sound where the target's fields are the source's **first** fields. Here they
// are not: `readName` would load `id` -- a `double` -- as an `NtsString *` and
// read a length through it. That was a **segfault** before it was a refusal, and
// swapping the two field declarations was the entire difference between a
// correct program and a crash.
//
// The answer is a copy of `readName` over `Thing`, reading `name` at *Thing's*
// offset:
//
//     func readName(v: managed<obj#1>) -> i32          the plain one
//     func readName@0obj3(v: managed<obj#3>) -> i32    the copy
//
// No cast, no dispatch, nothing to be wrong about. The plain one stays, because
// a call that passes the declared type still names it -- a structural copy is an
// addition, not a replacement, which is the difference from a generic.
//
// # Why a copy and not an interface, measured rather than chosen
//
// The other candidate was to lay the interface out like its single implementor,
// making the cast a real prefix. Two measurements killed it. **A prefix buys the
// JVM nothing**: that lane relates classes by name, so coinciding offsets are not
// a relation and `getfield Counted.n` still needs the object to *be* a `Counted`.
// And on ART there is no inline cache, so a monomorphic interface call costs
// 1.97x a direct read rather than HotSpot's 1.04x -- the case C2 makes free is
// the one that loses most without it.
//
// So specialisation is not "make dispatch predictable", which is worth nothing at
// a site that is already monomorphic. It is **remove dispatch**. Record 0294.
//
// # Two things the fixture is shaped to catch
//
// `bothOrders` passes a class whose layout is a prefix *and* one whose layout is
// not, in one answer. The prefix case is specialised too -- it costs C and LLVM a
// copy they did not need, and it is what closes the JVM's long-standing
// `a-structural-cast-that-is-a-prefix` gap, because a copy over `Prefixed` takes
// a `Prefixed` and there is no cast to relate anything.
//
// `twoImplementors` calls one function with two different classes, so the two
// copies must read *different* offsets. One copy serving both would answer one of
// them wrongly, and with a single implementor that mistake is invisible.
//
// # Transitive, since 2026-09-22
//
// `describe(v: Named) { readName(v) }` called with a `Thing` gets a copy, and
// inside that copy the call to `readName` is a new mismatch: `v` is a `Thing`
// there and `readName` still declares `Named`. The pass used to read argument
// types from the source, where `v` is declared `Named`, so it never saw it,
// and the copy called the *original* `readName` with a `Thing` -- exactly the
// cast the copy exists to avoid, refused by `coerce`. `runtime/node/stream` is
// chains of this shape: `onWritableConstructed(stream)` handing `stream` to
// `clearBuffer`, `finishMaybe`, `errorOrDestroy`.
//
// `structural_instantiations` walks every copy's body now, to a fixpoint. A
// parameter passed on **as itself**, or a `const` alias of one -- node's own
// code writes `const stream = source;` before handing it on -- carries the
// copy's type and the callee gets a copy of its own; a `let`, a field read
// or a call result is what the checker says, as in the original. Inside the
// copy the alias is *bound* at the copy's type too, or its own declaration
// would be the cast the copy exists to avoid. Each copy is walked once, so
// the walk ends. `Structural::at_call` is keyed by the enclosing copy,
// because the same call node names different callee copies in different
// copies.
//
// # A capture inside a copy, which segfaulted and is a closure of its own now
//
// An arrow inside a copy that captures the re-typed parameter stored a
// `Thing` into a closure field the arrow's body reads as `Named` -- the
// building side typed the field by the *value* and the reading side by the
// checker, and only inside a copy do the two differ. `s.name` in the arrow
// read `id` as a string pointer: signal 11 where node answers 4, on the
// binary before the transitive walk as well.
//
// A closure is lowered once, so the copy cannot re-type it. `closure_variants`
// gives every closure a copy re-types a capture of a closure of its own: the
// same node and captures, the re-typed ones at the copy's types, lowered in
// the copy's context so the calls in its body name what the copy's do.
// `captured_as` is the one derivation both sides of a capture use, and a
// capture whose two types still differ -- which no variant leaves -- is
// refused by name rather than cast, on every lane, because the
// prefix-compatible spelling would pass here by luck of layout and be
// declined on the JVM. (`capturedInAnArrow`, `capturedTwice`, below.)

interface Named {
  name: string;
}

class Thing {
  id: number;
  name: string;

  constructor(n: number) {
    this.id = n;
    this.name = "thing";
  }
}

/** The same shape with the fields the other way round, so the cast *is* a prefix. */
class Prefixed {
  name: string;
  id: number;

  constructor(n: number) {
    this.name = "prefixed!";
    this.id = n;
  }
}

function readName(v: Named): number {
  return v.name.length;
}

/** Under test: the layouts disagree, which used to be a segfault. */
export function notAPrefix(n: number): number {
  return readName(new Thing(n)) + n * 0;
}

/** Control: the layouts agree, which used to be correct by luck of declaration order. */
export function isAPrefix(n: number): number {
  return readName(new Prefixed(n)) + n * 0;
}

/**
 * Under test: both in one answer. `"thing"` is 5 and `"prefixed!"` is 9, so a
 * copy serving both would answer one of them wrongly.
 */
export function bothOrders(n: number): number {
  return readName(new Thing(n)) * 100 + readName(new Prefixed(n)) + n * 0;
}

interface Sized {
  size: number;
}

class Small {
  size: number;
  tag: string;

  constructor(n: number) {
    this.size = n & 3;
    this.tag = "s";
  }
}

class Large {
  tag: string;
  extra: string;
  size: number;

  constructor(n: number) {
    this.tag = "l";
    this.extra = "xx";
    this.size = (n & 3) + 10;
  }
}

function readSize(v: Sized): number {
  return v.size;
}

/**
 * Under test: one function, two implementors, three different offsets for
 * `size` between them. Two copies that read the same offset would agree with
 * node on one of these and not the other.
 */
export function twoImplementors(n: number): number {
  return readSize(new Small(n)) * 100 + readSize(new Large(n));
}


/** A copy's body passing its parameter on: `describe`'s copy calls `readName`'s. */
function describe(v: Named): number {
  return readName(v) * 2;
}

export function throughTwoCalls(n: number): number {
  return describe(new Thing(n)) + n * 0;
}

/** Three deep, and the innermost is the one reading the field. */
function relay(v: Named): number {
  return describe(v) + 1;
}

export function throughThreeCalls(n: number): number {
  return relay(new Thing(n)) + n * 0;
}

/** Two callers with different layouts through one chain: two chains of copies. */
export function twoChains(n: number): number {
  return relay(new Thing(n)) * 100 + relay(new Prefixed(n)) + n * 0;
}

/** A copy calling itself: the same copy, not a new one per depth. */
function countDown(v: Named, depth: number): number {
  if (depth <= 0) {
    return v.name.length;
  }
  return countDown(v, depth - 1) + 1;
}

export function recursiveChain(n: number): number {
  return countDown(new Thing(n), n & 3);
}

/** An arrow inside a copy capturing the re-typed parameter: a variant of the closure. */
function viaArrow(v: Named): number {
  const read = (): number => v.name.length;
  return read() + 1;
}

export function capturedInAnArrow(n: number): number {
  return viaArrow(new Thing(n)) + n * 0;
}

/** Two callers, two variants of one closure, reading two different offsets. */
export function capturedTwice(n: number): number {
  return viaArrow(new Thing(n)) * 100 + viaArrow(new Prefixed(n)) + n * 0;
}

/** A `const` alias of the parameter, passed on and captured: both carry the copy's type. */
function viaAlias(source: Named): number {
  const stream = source;
  const read = (): number => stream.name.length;
  return readName(stream) * 10 + read();
}

export function throughAnAlias(n: number): number {
  return viaAlias(new Thing(n)) + n * 0;
}

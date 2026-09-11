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

/** Under test: the interface reached through a second call, so the copy is chosen twice. */
function describe(v: Named): number {
  return readName(v) * 2;
}

export function throughTwoCalls(n: number): number {
  return describe(new Thing(n)) + n * 0;
}

// expect: a `Thing` where a `Named` is wanted
//
// **A blocker whose refusal is the fix, for now.** It reproduces, and it should
// go on reproducing until an interface has a representation that does not need a
// pointer cast — which is the design step `blockers/method-syntax-in-an-interface`
// names. What it replaced was not a refusal: it was a **segfault**.
//
// A compiled reference is a pointer, so reading a value as another object type is
// a pointer cast. `coerce` emitted one for every pair of object types, on the
// strength of a sentence that was true of the pair it was written for:
//
//     "Two managed types is an upcast, which base-first layout makes a
//      no-op pointer cast"
//
// Base-first layout is a fact about a *base*. A subclass keeps its base's fields
// at their offsets, so the cast is free. A **structural** target has no such
// guarantee:
//
//     class Thing  { id: number; name: string }   name at offset 32
//     interface Named { name: string }            name at offset 24
//
// `readName` then loads `id` -- a `double` -- as an `NtsString *` and reads its
// length through it. Measured rather than read off the C: the addon exits on
// **SIGSEGV** where node answers 6.
//
// # Why declaration order is the whole of it
//
// `class Prefixed { name: string; id: number }` puts `name` at 24 in both
// layouts, and that program is correct -- built, run, and it answers 6 like
// node. Swapping the two field declarations is the entire difference between a
// correct program and a crash, and nothing in the compiler, the gate or the
// examples said so. `examples/a-structural-cast-that-is-a-prefix` is the half
// that must keep working, and every conversion in it is a genuine prefix.
//
// # Why a refusal rather than a conversion
//
// A conversion would be a copy, and a copy is not the same object. `readName`
// writing through its parameter has to be visible to the caller -- that is what
// a reference means -- so a copy would trade a crash for a silent wrong answer,
// which is the worse of the two. The prefix case is genuinely a no-op and it is
// the one that is admitted.
//
// # What it does not cover
//
// The same question for an *erased* value reaching a concrete slot, which
// `coerce` answers with `Unerase` under `every_arm_descends_from`. That path
// asks about the hierarchy and this one is about layout, and they are separate.

interface Named {
  name: string;
}

class Thing {
  id: number;
  name: string;
  constructor(n: number) {
    this.id = n;
    this.name = "t";
  }
}

function readName(v: Named): number {
  return v.name.length;
}

export function subject(n: number): number {
  return readName(new Thing(n)) + n;
}

/** The control: the same shape with the fields declared the other way round. */
class Prefixed {
  name: string;
  id: number;
  constructor(n: number) {
    this.name = "t";
    this.id = n;
  }
}

export function control(n: number): number {
  return readName(new Prefixed(n)) + n;
}

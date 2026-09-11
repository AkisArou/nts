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
// # Measured on 2026-09-11, and then the unit was corrected
//
// Four live units for one refusal, and a number travelling without one is the
// problem rather than any of them being wrong:
//
//     module   sites  distinct messages  files  census "things"
//     fs         69           46           25        27
//     http       53           39           21
//     net        48           34           17
//     stream     46           32           16
//
// My first count was **sites**, and sites are the wrong unit to plan with. The
// fix is bounded by the 27 named declarations; the 69 counts how often one of
// them is called. Ranking lowering work by sites over-weights whatever is
// called most, and a structural cast is called a lot *precisely because*
// interfaces are everywhere -- so the unit that flatters this item is the one
// that says least about the work.
//
// 27 declarations is still the largest lowering item either lane has counted.
// "Biggest by sites" and "biggest by declarations" are different claims and only
// the second is about effort.
//
// What nobody has measured is what it is worth in **published exports**, which
// is the only unit that maps to the compiled axis and needs a compiler with the
// cast fixed to answer. Recorded as a gap rather than estimated.
//
// In `fs`, **37 distinct `(from, to)` pairs over 35 distinct target types**. The
// shape is uniform: a concrete class passed where a structural interface is
// wanted --
//
//     a `Writable` where a `WritableImplementation` is wanted
//     a `Readable` where an `ErrorOrDestroyStream` is wanted
//     a `BigIntStats` where a `CpFileIdentity` is wanted
//     a `UVExceptionError` where a `UVError` is wanted
//
// # The split that decides the design: 26 and 9
//
// Of the 35 target interfaces, **26 are only ever parameter types** and **9 are
// also stored as a field** -- `WritableImplementation` is both, declared as a
// parameter in four places and as `readonly stream: WritableImplementation` in
// one.
//
// That matters because the two want different answers:
//
// **A parameter can be specialised.** `readName(v: Named)` called with a
// `Thing` can be lowered as a copy of `readName` over `Thing`, reading `name`
// at *Thing's* offset -- no cast, no indirection, and faster than either
// alternative. The machinery exists: `Substitution` maps a `TypeId` to an
// `HirType`, so binding `Named -> Object(Thing)` makes `represent(Named)`
// answer Thing's layout inside that copy. It is what a generic function copy
// already is, with the parameter's declared type standing in for a type
// parameter. No backend changes at all.
//
// **A stored field cannot.** `readonly stream: WritableImplementation` has to
// hold *some* representation, and which concrete class is in it is not a
// property of the declaration. That needs an interface to have a
// representation, which is the design step
// `blockers/method-syntax-in-an-interface` names and which neither backend has
// today.
//
// So the honest statement is that three quarters of this is a lowering change
// and one quarter is a representation change, and they should not be attempted
// as one thing. The specialisation half is also the half that can be measured
// against node immediately, because it changes no ABI.
//
// Where specialisation cannot apply -- an argument whose concrete type is not
// known at the call, which is exactly the case where the value came out of one
// of those 9 fields -- the refusal stays, and it stays for a reason a reader
// can act on rather than the same sentence for both halves.
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

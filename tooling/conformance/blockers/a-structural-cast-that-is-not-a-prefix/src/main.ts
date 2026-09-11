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
// # The implementor counts, and the threshold they are measured against
//
// The JVM lane priced a *nominal* interface -- known at compile time, varying
// only how many classes implement it -- and the curve is HotSpot's inline cache
// exactly:
//
//     direct field read       1092 ns/pass
//     interface, 1 impl       1141 ns/pass    1.04x   free
//     interface, 2 impls      1319 ns/pass    1.21x   cheap
//     interface, 3 impls      3703 ns/pass    3.39x   the cliff
//
// Monomorphic is a guarded direct call, bimorphic is two guards, and at three
// HotSpot gives up and every call walks a vtable and an itable. Their earlier
// 6213-against-1759 figure was the *megamorphic* point measured as if it were
// the whole story, and it does not transfer to this case.
//
// Counted across `fs`, `http`, `net`, `stream`, `dgram` and `process`:
//
//     implementors   interfaces
//          1             26
//          2              3
//          3              2
//          4              1
//
//     ErrorOrDestroyStream 4   HighWaterMarkOptions 3   DestroyableStream 3
//
// **29 of 32 sit at or below the bimorphic row.** The three exceptions are named
// rather than a proportion, so they can be decided individually instead of
// setting the representation for all of them.
//
// # And then the statistic above turned out to be the wrong one
//
// **The inline cache is attached to the call site, not to the type.** Measured
// by the JVM lane with four implementors all live in one program:
//
//     a site that sees 1 of 4    1105 ns/pass    the direct-read row
//     a site that sees all 4     6519 ns/pass
//
// So "how many classes implement this interface" decides nothing. "How many
// concrete types arrive at *this site*" decides everything, and an interface
// with four implementors is free at every site that sees one.
//
// Measured here, across `fs`, `http`, `net`, `stream`, `dgram` and `process`:
//
//     277 refusal lines
//      63 distinct sites
//      63 distinct (site, arriving type) pairs
//
// **Every site sees exactly one concrete type. Not one is polymorphic.**
//
// Which settles the design by removing the question: at every site in this
// corpus an interface and a specialised copy are *both* on the monomorphic row,
// so dispatch cost does not choose between them. Specialisation wins on the
// other lane's terms instead -- C has no interface mechanism at all, and a
// pointer read through a known layout needs no guard to elide.
//
// The first version of this count keyed sites on a path fragment a loose regex
// captured, which would merge two files sharing a basename. It gave 60 sites and
// the same conclusion; it is recorded because the conclusion being unchanged is
// luck, not evidence, and a number that decides a design was worth re-taking
// with full paths.
//
// # The implementor counts, kept because they are a lower bound and were the
// # wrong question
//
// **This is a lower bound**, and the bound matters here. It counts distinct
// `from` types per `to` in the refusal messages, so it sees implementors that
// were assigned at a cast the compiler *refused*. A class satisfying an
// interface that is only ever passed where the layouts happen to be a prefix
// does not appear. `WritableImplementation` at 2 could be 3 in truth, and 3 is
// exactly the cliff -- so it should not be decided on this number alone.
//
// # Why the two halves are one measurement
//
// Specialisation does not merely remove a cast: **it moves every site to the
// 1.04x row by construction**, because a copy per concrete argument type means
// each call sees one type. So "specialise the parameters" and "give the fields
// an interface" are not two fixes for two populations -- they are this curve
// read at two points.
//
// Which makes the rule simpler than parameter-versus-field: **specialise
// wherever the concrete type is known, and use an interface only where it is
// not.** The stored field is where the type genuinely is not known, which is the
// same sentence arrived at from the other end.
//
// The unmeasured risk is copy count. This lane already emits a class per generic
// instantiation and 14 of them is invisible; hundreds of copies of one function
// is measured by nobody, and should be sized before building rather than after.
//
// # How to build the specialisation, including the part I got wrong
//
// **Correction, and I told both lanes the wrong thing first.** I said the
// machinery already exists: `Substitution` maps a `TypeId` to an `HirType`, so
// binding `Named -> Object(Thing)` would make `represent(Named)` answer Thing's
// layout inside that copy. **It would not.** `representation_of` consults the
// substitution in exactly one arm:
//
//     TypeKind::TypeParameter { .. } => subst.get(&ty)?.clone(),
//
// An interface is `TypeKind::Object`, which takes the object arm and never looks
// at it. A copy carrying that binding would have been byte-identical to the
// original.
//
// The fix is a general lookup at the top of `representation_of` -- *any* bound
// type answers with what it is bound to. **Verified as a no-op today**: applied,
// built, and the corpus is identical (54 lowered, 0 invalid HIR) because nothing
// populates such a binding. It is not committed, because a one-line widening
// with no user is dead weight and its blast radius -- every representation query
// in the compiler -- should be reviewed against the pass that needs it, not
// before.
//
// # The pass-order obstacle, which is the other non-obvious part
//
// Deciding which calls need a copy requires asking whether the argument's layout
// is a **prefix** of the parameter's, and `laid_out_as_a_prefix` needs layouts.
// Layouts accumulate *during* lowering -- `collect_layouts` runs at four points
// as functions are built -- so a pre-pass has none to read.
//
// The route is a throwaway `FuncBuilder::new(snapshot)` probe, which is what
// `members_of` already does: `layout_of` builds a layout from the snapshot on
// demand. The hazard is that a probe's layouts must **not** be merged into the
// program -- `layout_of` is not a query, and two of the four `collect_layouts`
// calls do merge a probe's. A probe whose layouts are discarded is safe.
//
// # The copy count, sized before building rather than after
//
//     63 sites, each seeing one type
//     39 distinct (file, arriving type) pairs across six modules
//
// So tens of copies, not hundreds, which is well below where the JVM lane's
// class-loading and code-cache question bites. Their lane already emits a class
// per generic instantiation and 14 of those is invisible.
//
// # A third obstacle, and then a simpler design that avoids all three
//
// The specialisation route has one more non-obvious step. The **caller** coerces
// each argument to the parameter's representation, and it computes that from the
// callee's *declared* signature -- `parameter_type_id` answers `Named`, whose
// representation in the caller is `Object(Named)`. So a call to a specialised
// copy would still meet the prefix check and still refuse, unless
// `coerce_to_parameter` is also taught to read this call's substitution. Three
// obstacles found in twenty minutes of design, each solvable, which is itself
// information about how much more there is.
//
// # The alternative: lay the interface out like its implementor
//
// **If an interface has exactly one implementing class in the program, give it
// that class's field order.** Then `Thing -> Named` *is* a prefix, the existing
// cast is correct, and nothing else changes -- no copies, no suffixes, no
// widening of `representation_of`, no call-site coercion change. One mechanism
// in one place.
//
// The measurement says this covers most of it: **26 of 32 interfaces have one
// implementor**, and every one of the 63 sites sees exactly one concrete type.
//
// **The open question, and it is the whole of whether this works.** The
// implementor counts above are a *lower bound* -- they come from refusal sites,
// so they see a class assigned to an interface only where the cast was refused.
// A second implementor whose layout happens to be a prefix already **works
// today** and is invisible to this count. Ordering the interface to match
// implementor A would break it: `laid_out_as_a_prefix` would refuse a cast that
// currently succeeds, which is a regression rather than a safe degradation.
//
// So this design needs the *complete* set of classes satisfying each interface,
// which is a question for the checker rather than for the refusals, and the
// snapshot does not carry structural assignability today.
//
// **Neither design is chosen.** The specialisation has three known obstacles and
// no unknown ones; this has one obstacle that decides whether it works at all.
// That is the comparison worth having before either is built, and it is recorded
// rather than resolved because resolving it means asking the frontend a question
// it is not currently asked.
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

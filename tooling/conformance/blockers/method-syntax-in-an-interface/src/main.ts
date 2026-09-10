// expect: with a type that has no representation
//
// A member of an interface written in **method syntax**. 24 distinct named
// things across 7 modules, and the fourth-largest unfiled root.
//
// The sites are stream's shape interfaces -- `destroy` on
// `ClassicWritableLike`, `writev` and `writevSync` on `AsyncWriter`, `_read` on
// `Readable`, `_construct` on `DestroyableStream`.
//
// # The same declaration written the other way compiles
//
// This is the whole finding, and it took the matrix to see it:
//
//     interface Sink { read: (n: number) => void }    compiles
//     interface Sink { destroy?: (r: number) => void } compiles
//     interface Sink { read(n: number): void }        refuses
//     interface Sink { destroy?(r: number): void }    refuses
//     class Sink { read(n: number): void { … } }      compiles
//     interface Sink { size?: number }                compiles
//
// **A property whose type is a function type compiles. The same member in
// method syntax does not.** In TypeScript the two differ only in variance under
// `strictFunctionTypes`; they describe the same value and the same layout. And
// a class declaring the identical method compiles, so it is not method syntax
// as such -- it is method syntax *in an interface*.
//
// That matters for what a fix looks like. The message reads as a
// representation gap for function types, and the first row says there is no
// such gap for a *property*: one spelling already has a layout.
//
// It also matters for what a fix is *not*. Rewriting stream's interfaces from
// `destroy?(reason: number): void` to
// `destroy?: (reason: number) => void` would make 24 things compile and would
// be rewriting correct source to route around a refusal. The declarations are
// node's shape written the way node's own types write it. Hence a fixture.
//
// # The cause, and why the one-line version of it is wrong
//
// Found by the compiler lane and recorded here because it changes what this
// fixture is asking for. `fields_of` has
// `if !property.kind.is_stored() { continue; }`, and `MemberKind::Method` is
// not stored -- **right for a class**, whose method lives in the dispatch
// table, and **wrong for an interface** satisfied by
// `{ read: (x) => x + 1 }`, where it is data. One line.
//
// They did not change it, and the reason is worth more than the fix would have
// been. `class C implements I` gives `C` its own layout from `C`'s type. If `I`
// gains a stored slot for a method member, `I`'s layout and `C`'s stop agreeing
// about offsets, and a `C` passed where an `I` is expected reads the wrong ones
// -- silently, which is the failure mode this compiler refuses everywhere else.
// It is the same shape as `upcast-to-base` being free only because base fields
// come first.
//
// # 2026-09-10: the hazard above is not hypothetical, and never was
//
// The paragraph reasons that *if* `I` gained a stored slot, `I`'s layout and
// `C`'s would stop agreeing about offsets and a `C` passed as an `I` would read
// the wrong ones silently. It uses that as a reason not to take the one-line
// fix. The reasoning is right and it stopped one step short: **it is already
// true**, for any interface whose field order differs from the class's, with no
// change to method members at all.
//
//     interface Named { name: string }
//     class Thing { id: number; name: string }
//     function readName(v: Named): number { return v.name.length; }
//     readName(new Thing(5))          // SIGSEGV; node answers 6
//
// `Thing.name` is at offset 32 and `Named.name` at 24. The emitter writes a raw
// pointer cast, so `readName` loads `id` -- a double -- as an `NtsString *`.
// Declare the class as `{ name; id }` and the same program is correct.
//
// MainClaude found it by reading the emitted C for something else, and observed
// that this paragraph had the mechanism, the `upcast-to-base` analogy and the
// word "silently" already.
//
// **The lesson is about the shape of the reasoning, not the conclusion.** A
// consequence derived for a change you are declining is a consequence worth
// testing against the code you already have. The question never asked here was
// "is this true today?", and it cost the finding to somebody reading assembly
// for an unrelated reason.
//
// # 2026-09-10: the option space, with one branch closed by measurement
//
// The design step this paragraph names — what an interface's representation
// should be when both an object literal and a class instance can be one — is
// now blocking most of the 49 `runtime/node` cast sites. The obvious answers
// and what each costs:
//
//   1. **Order the class to satisfy its interfaces.** Closed. A class cannot
//      satisfy two interfaces whose field orders conflict, and this is
//      measured rather than argued:
//
//          interface AB { a; b }   interface BA { b; a }
//          class Both { a; b }
//          readAB(new Both())    crosses
//          readBA(new Both())    REFUSED
//
//      The same object, two interfaces, and no single layout satisfies both.
//      Any ordering rule has to pick a winner, and there is no principled
//      winner when both interfaces are equally legitimate.
//
//   2. **Copy at the boundary.** Rejected upstream already, and for the
//      stronger of the two available reasons: a copy is not the same object,
//      so a callee writing through its parameter becomes invisible to the
//      caller. That trades a crash for a silent wrong answer, which this
//      profile ranks as worse.
//
//   3. **Refuse.** What is landed. Safe, loud, and it holds the stream family
//      shut — `Readable`, `Writable`, `Duplex` against `ErrorOrDestroyStream`
//      and `WritableImplementation`, which is most of the sites.
//
//   4. **Indirection** — pass the object with an offset table, or read fields
//      through an accessor rather than a fixed offset. Unmeasured here. It is
//      the only option in this list that does not have to choose between
//      correctness and coverage, and it is also the only one that costs
//      something on every field read rather than at a boundary.
//
// **Base-first ordering, landed 04:47, is not one of these.** It fixes the
// *other* layout problem — interface extending interface, where the shared
// fields have identical representations and only position differed. That is
// eight sites and it cleared them. It does nothing for a class against an
// unrelated interface, because `EventEmitter`'s fields sit at the front of
// `Readable` correctly, so `ErrorOrDestroyStream { destroyed }` can never be a
// prefix of it.
//
// The conclusion still holds and is stronger for it: what an interface's
// representation should be, when both an object literal and a class instance
// can be one, is a design step. The refusal being landed for the field-order
// case is the honest placeholder for that -- it makes the hazard loud instead
// of silent, and it does not decide the design.
//
// **So this is not 24 things of layout work.** It is "what is an interface's
// representation when both an object literal and a class instance can be one",
// which is a design step and not a member-kind check. The count above is what
// it is worth, not how long it takes.
//
// # And it is worth more than 24 things
//
// `internal/abort.ts:23` declares
//
//     interface AbortSignalLike {
//       addEventListener(type: "abort", listener: AbortListener,
//                        options?: { once?: boolean }): void;
//     }
//
// in method syntax. `dgram`'s `Socket` constructor spans 302-380 and reads
// `signal.addEventListener` at line 360, and that is the **only** root inside
// it. `createSocket` cascades off the constructor:
//
//     dgram/src/main.ts:1193  `createSocket` cannot be compiled because it calls
//                             `Socket@dgram_src_main#constructor`, which was refused above
//
// Against the compiled `dgram` addon: 77 failing test files, **68 of them
// stopping at `dgram.createSocket is not a function`**.
//
// So the design step has 68 test files behind it in one module, which is worth
// knowing before deciding it is not tonight's work. The usual caveat applies --
// that is what stands in front of them, not what they would gain, and `Socket`
// has more roots outside its constructor.
//
// # A call cascades, so the refusal is on the declaration
//
//     interface Sink { read(n: number): void }
//     sink.read(1)      NTS1003 `f` cannot be compiled because it calls
//                       `Sink#read`, which was refused above
//
// The member is refused where it is declared, and every use of it is a cascade
// off that. So the count of 24 things is the count of declarations, and the
// cone off them is larger.

interface Sink {
  // Refuses. Written as `read: (n: number) => void` it compiles.
  read(n: number): void;
  // Refuses. Written as `destroy?: (reason: number) => void` it compiles.
  destroy?(reason: number): void;
}

export function describes(sink: Sink): boolean {
  return typeof sink.read === "function";
}

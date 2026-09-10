// expect: a private name this class and its base both declare
//
// **This replaced a wrong answer, and that is the whole of why it is filed.**
//
//     class Base    { #count = 0;   bumpBase()    { return ++this.#count; } }
//     class Derived extends Base
//                   { #count = 100; bumpDerived() { return ++this.#count; } }
//
// Two fields in JavaScript — that is what the `#` is for — and one slot here.
// The base-first construction matched them by name and dropped the derived
// one, so both classes read and wrote the base's storage.
//
// Measured against node, eleven lines, **28 of 28 cases disagree**: node answers
// 2102 and the compiled program answered 102502. No crash, no refusal, nothing
// in any instrument that was not looking for it.
//
// # What it is standing in front of
//
// `net.Server` declares `#connections = 0`. `http.Server extends NetServer` and
// declares `#connections = new Set<HTTPDuplex>()`. The two types differ, so the
// corpus got a refusal rather than a wrong answer — the `Set` meets the base's
// `Int32` slot and says so:
//
//     http/src/server.ts:154:17  a value of type Managed(Set(Managed(Object(…))))
//                                where Float { bits: 64 } is wanted
//
// That is `http.createServer`'s refusal, which the Node lane ranks as **274
// failing test files**, the largest single item on the compiled axis. Its
// message names a `Set` where a `Float` is wanted, which is the symptom two
// steps from the cause.
//
// It took three failed reductions to find. A private field holding a `Set` of a
// class, of an interface, and of an interface with method-syntax members all
// compile — because none of them has a **base** declaring the same private
// name, which is the precondition. That is the shape written down as *reduction
// removes the precondition*: minimising deleted the trigger three times.
//
// # Why refused rather than fixed
//
// The fix is to give a private field a name of its own so the two slots can
// coexist — `#count@Derived` beside `#count` — and that name is read back at
// **twelve** `index_of` sites. The access site can compute the right one,
// because a `#` member is only reachable inside the class that declares it, so
// the enclosing class is the qualifier. But doing half of that to a defect that
// is currently a *wrong answer* would be worse than refusing it outright, and
// the refusal is what stops the miscompile today.
//
// The base's copy has to keep its **index**, because an upcast is a pointer cast
// and base-first layout is what makes that free. Its *name* is another matter,
// and that suggests a one-place fix: rename the **inherited** copy, leaving the
// plain name to the derived class where every access asks for it. The index is
// what runs, so a method of the base still reads slot 0 whatever slot 0 is
// called.
//
// **That was tried, and what stopped it is in the snapshot rather than in the
// lowering.** Renaming the inherited copy to `#count@Base` produced two struct
// members with the same C name:
//
//     program.c:18:13  error: duplicate member '__count____Base'
//
// Not the mangling: `c_identifier` maps `#` to `__` and `@` to `____`, so
// `#count` is `__count` and `#count@Base` is `__count____Base`, which are
// distinct. Printing the two inputs says why:
//
//     base=Base  inherited=["#count"]  own=["#count", "#count"]
//
// **The derived class's own member list contains `#count` twice, and both
// records answer `own = true`.** One of them is the base's and one is the
// derived's, and nothing in `PropertyRecord` tells them apart: the checker
// returns a flattened list, `own` is the flag that exists for exactly this
// question, and for a *shadowed private name* it answers the same for both.
// Skipping `!own && name.starts_with('#')` therefore skips neither, and the
// rename fires twice.
//
// The order is recoverable without a schema change: the flattened list is
// **most-derived first**, which is `getPropertiesOfType`'s order, so the first
// `#count` is this class's and the rest are its ancestors'. Printed:
//
//     own = [("#count", Set), ("#count", Float)]
//
// on `class Base { #count = 0 }` / `class Derived extends Base
// { #count = new Set<number>() }`.
//
// **A second attempt used that and got two fields with the right types and the
// wrong order.** Keeping only the first `#count` in `fields_of` and renaming the
// inherited copy in the base-first construction produced
//
//     Derived   #count : Managed(Set(Float))
//               #count@Base : Int
//
// — the derived's at slot **0**. Base-first layout requires the inherited one
// there, because a method of the base operates on a `Base *` and reads slot 0;
// with the derived's field sitting in it, `bumpBase` and `bumpDerived` shared a
// counter again and the same 28 of 28 cases disagreed, with the same numbers.
//
// So both fields can be built and the remaining work is entirely about **where**
// they land. That is `after_the_base`'s construction, not the member list, and
// it is where a third attempt should start. Reverted; the refusal above is what
// stands.
//
// # The control
//
// `Separate` uses a private name its base does not, which is every other private
// field in the tree, and compiles.

class Base {
  #count = 0;
  bumpBase(): number {
    this.#count += 1;
    return this.#count;
  }
}

class Derived extends Base {
  #count = 100;
  bumpDerived(): number {
    this.#count += 1;
    return this.#count;
  }
}

export function subject(n: number): number {
  const d = new Derived();
  d.bumpBase();
  d.bumpDerived();
  return d.bumpBase() * 1000 + d.bumpDerived() + n * 0;
}

/** The control: a private name the base does not declare. */
class Separate extends Base {
  #total = 100;
  bumpSeparate(): number {
    this.#total += 1;
    return this.#total;
  }
}

export function control(n: number): number {
  const s = new Separate();
  s.bumpBase();
  return s.bumpSeparate() + n * 0;
}

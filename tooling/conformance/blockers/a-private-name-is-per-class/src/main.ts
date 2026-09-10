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
// **That was tried and it does not work as written.** Renaming the inherited
// copy to `#count@Base` produces two struct members with the same C name:
//
//     program.c:18:13  error: duplicate member '__count____Base'
//
// `c_identifier` maps `#` to `__` and `@` to `____`, and those two spellings are
// distinct — `#count` is `__count` and `#count@Base` is `__count____Base` — so
// the collision is not the mangling. Something produces the renamed field
// twice, and the next attempt should start by finding out what rather than by
// choosing a different separator. Reverted; the refusal above is what stands.
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

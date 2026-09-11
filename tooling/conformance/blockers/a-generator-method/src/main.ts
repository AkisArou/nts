// expect: a `yield` outside a generator
//
// **A generator declared as a *method* is not recognised as a generator at
// all**, and the message says something that is true of this lowering and false
// of the source: the `yield` is inside a generator, written with a `*` in front
// of the method name.
//
//     function* plain() { yield 1 }          lowers, and `for...of` walks it
//     class C { *named() { yield 1 } }       a `yield` outside a generator
//     class C { *[Symbol.iterator]() { … } } the same
//
// It is **not** about symbol keys, which is the first thing to assume and is
// wrong: a plainly named `*named()` says it too. `generator_indices` walks every
// node carrying the `GENERATOR` modifier and has always had methods in it.
// `begin_generator` simply had one caller, `lower_function`, so a method reached
// its body with no frame reserved.
//
// # What it is under
//
// `*[Symbol.iterator]()` is how a class is made iterable, and `Symbol.iterator`
// is **26 sites across `runtime/node`** with `function*` at 29 and `yield` at
// 117. Counted rather than guessed, and with a control: `decodeURIComponent`
// was 8 sites and gated `querystring.parse`.
//
// # Why it is filed rather than fixed, which is the part worth reading
//
// The declaration half is about fifteen lines and it was written, measured and
// **thrown away** on 2026-09-11. Calling `begin_generator` from
// `lower_method_of`, taking the frame as the return type and materializing only
// on the non-generator path, makes both refusals above disappear. The method
// then compiles.
//
// And nothing can call it. The *call site* resolves a generator's result
// through
//
//     declaration.and_then(|d| self.generators.get(&d))
//
// which needs the callee's **declaration node**. A plain call has one, from
// `call_targets`. A method call has a receiver type and a member name, and
// there is no route from those to the node: `Hierarchy` holds base, implements
// and declares -- all keyed by `TypeId` and `String` -- and `PropertyRecord`
// carries a name, a type, `readonly`, `optional`, `kind` and `own`, and no
// declaration. So the method compiles and every `for...of` over it still says
// `a call result of unrepresentable type (Generator)`.
//
// Landing the declaration half alone emits a function nothing can reach, which
// is worse than the refusal: a reader would see a generator method compile and
// conclude the feature works.
//
// # What it would take, which is now agreed rather than open
//
// A route from a member to its declaration, which is a **frontend** question
// rather than a lowering one. Two candidates, and the JVM lane settled it on
// 2026-09-11 with an argument worth keeping because it is not a rule being
// carried over:
//
//     a declaration node on `PropertyRecord`      agreed
//     a `(TypeId, member) -> NodeId` map beside   rejected
//
// Both answers exist in this tree and they look contradictory until the subject
// is named. `declared_by` went **on `Field`**, because the subject of "which
// class declares this" is the field. `ClassIdentity` went **beside** the layout
// in `Program::classes`, because the subject of "which class is this" is the
// class, and a layout is a merge of several -- on `Layout` it would have been a
// field that is sometimes one value and sometimes many.
//
// So the question is not "on the record or in a map" but *what is the fact
// about*. "Where was this member declared" is about the member, and
// `PropertyRecord` **is** the member: a declaration completes it rather than
// extending it. A map keyed by `(TypeId, member)` is a second structure keyed
// by what the first is already keyed by, and it agrees until someone adds a
// member through one path and not the other.
//
// The map is cheaper to add, and that is the whole of its case.
//
// # The JVM backend needs nothing, which removes an unknown from the decision
//
// Measured by that lane rather than assumed. Generators already work there --
// each becomes a `<name>$frame` class implementing `NtsResumable`, and a frame
// captures its parameters as fields. A method's `this` is parameter zero, so it
// becomes one more field, a reference one rather than a double, which frames
// already hold. Once the declaration and the call resolve upstream it arrives
// as an ordinary generator with one more parameter.
//
// Two things it is *not*, both tried and rejected: keying the generator map by
// the lowered name `Owner#member` joins two strings that the symbol mangling
// and generic suffixing each pull apart, and it fails by falling through to a
// refusal, which is safe and untraceable. And resolving the class node from its
// `TypeId` is the same missing map wearing a different name.
//
// # Why a half-landing is worse here than elsewhere
//
// A compiled-and-unreachable method **produces no event at all, in any lane,
// ever**. There is no instrument that could catch it: it is not a refusal, not
// a wrong answer, not a crash, and not a missing symbol -- the symbol is there.
// The only observer is a reader, who sees a generator method compile and
// concludes the feature works.
//
// That is a sharper reason than the one this directory usually runs on. A throw
// absorbed by a floor at least happens at run time.
//
// # The other four, which this does not cover
//
// Each was measured the same day and each is its own thing:
//
//     g.next() by hand              a method `next` with no declaration
//     yield*                        refused by name
//     [...generator]                a copy of something that is not an array
//     g.return(v)                   as `next`
//
// A `for...of` over a generator *function* works, which is the control that
// makes all of the above about something other than generators-in-general.

/** Control: a generator function, walked by `for...of`. Lowers. */
function* plain(n: number): Generator<number> {
  for (let i = 0; i < n; i++) yield i;
}

export function viaPlain(n: number): number {
  let total = 0;
  for (const v of plain(n & 3)) total += v;
  return total;
}

class Counter {
  limit: number;
  constructor() {
    this.limit = 3;
  }

  /** Under test: a generator method with an ordinary name. */
  *named(): Generator<number> {
    for (let i = 0; i < this.limit; i++) yield i;
  }

  /** Under test: the same, symbol-keyed, which is how a class is made iterable. */
  *[Symbol.iterator](): Generator<number> {
    for (let i = 0; i < this.limit; i++) yield i * 2;
  }
}

export function viaNamedMethod(n: number): number {
  let total = 0;
  for (const v of new Counter().named()) total += v;
  return total + n * 0;
}

export function viaIterable(n: number): number {
  let total = 0;
  for (const v of new Counter()) total += v;
  return total + n * 0;
}

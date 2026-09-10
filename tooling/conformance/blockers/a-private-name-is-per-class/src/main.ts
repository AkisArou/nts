// expect: lowers
//
// **Kept as a guard. Fixed 2026-09-10, in five places, every one of which
// compared names.**
//
//     class Base    { #count = 0;   bumpBase()    { return ++this.#count; } }
//     class Derived extends Base
//                   { #count = 100; bumpDerived() { return ++this.#count; } }
//
//     node 2102     before 102502     28 of 28 cases disagreed
//
// Two fields in JavaScript — that is what the `#` is for — and one slot here.
// The derived's was dropped and both classes read and wrote the base's storage.
// It refused in the corpus rather than answering, only because the two types
// differ there: `net.Server`'s `#connections = 0` against `http.Server`'s
// `#connections = new Set<HTTPDuplex>()`. That refusal was `http.createServer`'s,
// which the Node lane ranked as **274 failing test files**, the largest single
// item on the compiled axis — and which was reported before that as `a
// declaration outside every walk`, a message that was simply false.
//
// # The places, because each was a separate discovery
//
// **`Field::declared_by`** — the class that declares a field, stated where it
// is known rather than derived from a name. Everything below is a consumer.
//
// **`fields_of`** — the checker's member list is flattened and holds *both*
// records, most-derived first, with `own` answering true only for the class's
// own. So `declared_by` is `Some(ty)` exactly where `own` is, and `None`
// elsewhere; that `None` is what tells `after_the_base` which records are the
// ancestors' to discard.
//
// **`after_the_base`** — keep both `#` records, the base's from the base's own
// layout and the derived's from its own declarations. Keeping every `#` field
// in the flattened list instead gave a class that merely *inherits* `#count` a
// second slot nothing read — the opposite defect, and invisible in every answer.
// `compiler/core/tests/private_name_slots.rs` reads the layout for that reason.
//
// **`reorder_to_base_first`** — matches a base's field to a derived's, and by
// name alone it matched whichever `#count` came first, hoisting the *derived's*
// into slot 0. That undid the entire fix one pass later, silently. Keyed on the
// declaring class now.
//
// **`verify::check_layouts`** — the same comparison, which then reported
// `BrokenBase` for a layout that was right.
//
// **`initialize_fields`** — a field initializer runs where the object is
// allocated, so the base's `#count = 0` was writing whatever `#count` names in
// the *derived's* layout. Both initializers wrote offset 28 and offset 24 stayed
// zero. It asks `index_of_declared` now, being the one caller that knows which
// class it means.
//
// **`Layout::index_of`** — the last match for a `#` name and the first for
// anything else. An access by name is written inside a class body and a `#`
// member is reachable nowhere else, so the one meant is the innermost class's:
// the last, because base-first puts ancestors ahead of it.
//
// **`c_member_at`** — a C struct has one namespace where a JavaScript class has
// one per class, so two `#count` fields are `duplicate member '__count'` and
// clang refuses the whole program. C is the only backend that has to *name* a
// slot; the first of a name keeps the plain spelling and each later one takes
// its index.
//
// `laid_out_as_a_prefix` needed it too, and shares one `same_slot` with the
// verifier rather than repeating the rule — "two places that must agree" is what
// `Layout::same_shape`'s own comment says has cost this project a week.
//
// # Only a `#` name consults the declaring class
//
// A public field is the same property wherever it is declared — that is what
// makes `override readonly a = "4"` one slot — and consulting `declared_by` for
// one is not merely redundant, it is wrong: **structurally identical classes
// share a layout**. `class NoModifier { a = "1" }` and `class TwoBase { a: string
// = "x" }` are one `Layout` under the first one's name, so a derived class's
// inherited record names a class that layout does not, and every such class
// failed `check_layouts`. `examples/modifiers-on-a-field` caught it — a fixture
// about something else, and the only one in the tree with that shape.
//
// # A mangled name was tried first, and is a C-shaped answer
//
// The earlier fix renamed the inherited copy to `#count@t1`. It worked, and it
// worked only for a backend that addresses a field by index: on the JVM it is
// `NoSuchFieldError`. Two names were tried before the type id, and both failed
// for reasons worth keeping — the *type's* name is ambiguous, `net.Server` and
// `http.Server` being exactly the pair this has to separate, and the *layout's*
// name is assigned later by `unshared_layout_name`, after the qualifier has
// already been written into a field.
//
// The lesson is not which qualifier: it is that a qualifier in a shared `Layout`
// makes one backend's spelling every backend's problem. A stated fact leaves
// each lane to spell the distinction its own way, which is what `c_member_at`
// does and what the JVM's field hiding does for free.
//
// # What this guard certifies
//
// That both functions lower. It does not certify the answer — a layout with one
// slot lowers just as cleanly, which is what it did before.
// `examples/two-private-names-that-collide` is what asks node, and that is the
// half that matters, because the defect was a wrong answer rather than a
// refusal.
//
// The Node lane swept 619 (derived field, ancestor) pairs across 497 classes:
// `#connections` is the corpus's only collision. So this is worth one site in
// `runtime/node` and a class of silent wrong answer everywhere else.
//
// # The JVM expresses it better than C does
//
// Java has field hiding, so `Derived.$count` and `Base.$count` are two fields
// the verifier already tells apart: that lane needs no suffix at all, only the
// declaring class to emit the right owner. It was the lane that asked for
// `declared_by`, having been inferring the owner by arithmetic — "the highest
// ancestor still long enough to contain this index" — which is a guess that
// happens to be right until two classes declare one name.

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

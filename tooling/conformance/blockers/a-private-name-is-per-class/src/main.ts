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
// # The five places, because each was a separate discovery
//
// **`fields_of`** — the checker's member list is flattened and holds *both*
// records, most-derived first, with `own` answering `true` for each. Keep the
// first of a repeated `#` name; the rest are ancestors'.
//
// **`after_the_base`** — rename the **inherited** copy, not the declaring one.
// The plain name then stays where every access inside the derived class asks for
// it, and none of the twelve `index_of` sites has to learn a qualifier.
//
// **`reorder_to_base_first`** — matches a base's field to a derived's by name,
// so the renamed one stopped matching, and it hoisted the derived's field into
// slot 0. That undid the entire fix one pass later, silently.
//
// **`verify::check_layouts`** — the same comparison, which then reported
// `BrokenBase` for a layout that was right.
//
// **`initialize_fields`** — a field initializer runs where the object is
// allocated, so the base's `#count = 0` was writing whatever `#count` names in
// the *derived's* layout. Both initializers wrote offset 28 and offset 24 stayed
// zero.
//
// `laid_out_as_a_prefix` needed it too, and shares one `same_slot` with the
// verifier rather than repeating the rule — "two places that must agree" is what
// `Layout::same_shape`'s own comment says has cost this project a week.
//
// # The qualifier is a type id, and two names were tried first
//
// The *type's* name is ambiguous: `net.Server` and `http.Server` are both
// `Server`, which is exactly the pair this has to separate, so http's
// `#connections@Server` found net's field. The *layout's* name is
// disambiguated — and disambiguated **later**, by `unshared_layout_name` at
// merge time, after the qualifier has already been written into a field. An id
// is unique by construction and fixed before either.
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
// # And it does not travel to the JVM
//
// That lane addresses a field by name and class, so a renamed inherited copy is
// `NoSuchFieldError: nts.gen.Base does not have member field 'int $count$t1'`.
// It can express the case **better** than C can — Java has field hiding, so
// `Derived.$count` and `Base.$count` are two fields the verifier already tells
// apart — and what does not travel is the rename, which is a C-shaped answer
// written into a shared `Layout`. The durable form is a `declared_by` on `Field`
// rather than a mangled name.

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

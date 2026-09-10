# Five places that compared names

Record 0263 refused a shadowed private name because fixing it looked like
twelve `index_of` sites. It was five, and none of them was one of the twelve.

    class Base    { #count = 0;   bumpBase()    { return ++this.#count; } }
    class Derived extends Base
                  { #count = 100; bumpDerived() { return ++this.#count; } }

    node 2102     before 102502     28 of 28 cases disagreed

## Each place found by following the value, not by reading

**`fields_of`.** The checker's member list is flattened and holds *both*
records, and `own` — the flag that exists for exactly this question — answers
`true` for each. What separates them is order: most-derived first, which is
`getPropertiesOfType`'s. Printed:

    own = [("#count", Set), ("#count", Float)]

**`after_the_base`.** Rename the **inherited** copy, not the declaring one. The
plain name then stays where every access inside the derived class asks for it,
and none of the twelve `index_of` sites has to learn a qualifier — which would
have to come from the enclosing class, where a wrong qualifier is a silent wrong
answer, which is the thing being fixed.

**`reorder_to_base_first`.** A whole pass that reorders a derived layout to match
its base's, **by name**. The renamed field stopped matching, so it hoisted the
derived's `#count` into slot 0 — the base's slot — and undid the entire fix one
pass later. `after_the_base` returned `["#count@Base", "#count"]` and the emitted
struct had them the other way round; that gap is what said a later pass was
responsible.

**`verify::check_layouts`.** The same comparison, which then reported
`BrokenBase { layout: "Derived", base: "Base" }` for a layout whose prefix was
exactly right.

**`initialize_fields`.** A field initializer runs where the object is
*allocated*, so the base's `#count = 0` was writing whatever `#count` names in
the derived's layout. Both initializers wrote offset 28 and offset 24 stayed
zero — visible in four lines of emitted C and in nothing else.

`laid_out_as_a_prefix` needed it too, and shares one `same_slot` with the
verifier rather than repeating the rule. `Layout::same_shape`'s own comment says
"two places that must agree" has cost this project a week.

## The qualifier is a type id, and two names were tried first

The **type's** name is ambiguous. `net.Server` and `http.Server` are both
`Server` — the exact pair this has to separate — so http's `#connections@Server`
found net's field and the corpus refusal did not move.

The **layout's** name is disambiguated, and disambiguated *later*:
`unshared_layout_name` renames at merge time, after the qualifier has been
written into a field. A name that is assigned after you use it is not a name.

An id is unique by construction and fixed before either. It reads badly, and it
is a private field's name, which no source writes and no diagnostic prints.

## It does not travel to the JVM, which can express it better

    NoSuchFieldError: nts.gen.Base does not have member field 'int $count$t1'

That lane addresses a field by **name and class** where C addresses it by index,
so a renamed inherited copy is a field nothing declares. And Java has field
hiding: `Derived.$count` and `Base.$count` can both exist and the verifier
already tells them apart, so that lane needs no rename at all.

The rename is a C-shaped answer written into a shared `Layout`. The durable form
is a `declared_by` on `Field` rather than a mangled name — a representation
change to agree with the JVM lane rather than land unilaterally, which is where
it stands.

Their other 152 examples pass with this in, swept one at a time. The floors are
154 on the LLVM lanes and 152 on theirs, with the gap named.

## What it bought

`http/src/server.ts:154` is gone and so is `no wrapper for createServer`.
`Server`'s constructor now refuses for five other things — a regular expression
literal, `this` outside a method, a class used as a value, indexing an object
type, and a structural cast — so the 274 files do not move yet. Five cleared and
five revealed, one layer down, which is the third time in a day.

The Node lane swept 619 (derived field, ancestor) pairs across 497 classes:
`#connections` is the corpus's only collision. So this is worth one site there
and a class of silent wrong answer everywhere else — and it is the second kind
that made it worth doing.

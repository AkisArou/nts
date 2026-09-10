# A stated fact instead of a mangled name

Record 0264 fixed a shadowed private name by renaming the inherited copy to
`#count@t1`. Correct, gated, and a C-shaped answer written into a shared
structure — which its own last section said, and which the JVM lane then asked
me to replace. This is that replacement, and it found a second defect the first
fix had been hiding.

    /// The class that declares this field, where it is a class's at all.
    pub declared_by: Option<TypeId>,

## The lane that could not use the answer

The JVM addresses a field by name *and* owning class, so `#count@t1` is
`NoSuchFieldError`. That lane had been inferring the owner by arithmetic — **the
declaring class is the highest ancestor still long enough to contain this
index** — which is right until two classes declare one name, at which point it
is confidently wrong in the same direction the C lane had just been fixed out
of.

Java has field hiding. `Derived.$count` and `Base.$count` are two fields the
verifier already tells apart, so that lane needs no suffix at all — only the
fact. The rename made one backend's spelling every backend's problem; a stated
fact leaves each lane to spell the distinction its own way. C's is `c_member_at`,
which suffixes by index because a C struct has one namespace and a JavaScript
class has one per class. LLVM needed nothing: it addresses a field by index and
never names one.

## The defect the rename had been hiding

With the rename gone, `after_the_base` kept every `#` field it was handed. The
checker's member list is flattened, so a class that merely *inherits* `#count`
has it in that list too — and got a second slot:

    struct NtsObj_Derived {
        NtsHeader header;
        int32_t __count;
        int32_t extra;
        int32_t __count_2;      <- nothing ever reads this
    };

**Every answer agreed with node.** A phantom slot is wrong without being
observable: no case diverges, no fixture fails, and the only cost is eight bytes
per object and a layout that says something untrue. The comparison harness could
not have caught it in any program, because there is no program in which it shows.

What caught it was writing the control first — a derived class inheriting
`#count` and not redeclaring it — and then looking at the struct rather than the
answer. It is now `compiler/core/tests/private_name_slots.rs`, which reads
layouts, and its two directions each fail under the opposite sabotage.

The fix is that `declared_by` is `Some` exactly where the checker's `own` is,
so an inherited record carries `None` and `after_the_base` discards it in favour
of the base's own — which is the record that knows the right declaring class.

## Only a `#` name may consult it

The obvious `same_slot` — name, declaring class, type — took the examples suite
from 156 of 156 to 155, and `examples/modifiers-on-a-field` was what reported it:
a fixture about modifier parsing, and the only one in the tree with the shape.

**Structurally identical classes share one layout.** `class NoModifier { a =
"1" }` and `class TwoBase { a: string = "x" }` are one `Layout`, under the
first one's name. So a class extending `TwoBase` inherits a record naming
`TwoBase`, checks itself against a layout whose records name `NoModifier`, and
fails `check_layouts` with `BrokenBase` — for a layout that is correct.

A public field is the same property wherever it is declared; that is what makes
`override readonly a = "4"` one slot. Only a `#` name is per class, and only a
`#` name asks. `Field::names_the_same_member` is the one place that says so,
and `same_slot` and `base_first_positions` both go through it.

Consulting more facts looked like more precision and was a wrong answer. The
narrower rule is the true one.

## What it cost and what it did not

Fourteen construction sites took the new field mechanically, seven more in test
modules that `--all-targets` found and a plain build did not, and one in
`nts-codegen-common` that neither found until clippy ran over the whole
workspace. `pointer_fields` returns indices now rather than names, for the same
reason everything else here does: **a name does not identify a slot.**

156 of 156 examples agree with node, 145 blockers as expected, the refusal
ledger unmoved in every one of its twelve entries. The private-name example
gained a sixth function and went from 145 cases to 174.

Nothing in the corpus changed shape, because the corpus has exactly one
collision — `net.Server`'s `#connections` against `http.Server`'s. This was
worth doing for the class of silent wrong answer everywhere else, which is the
same reason 0264 was, and this time the silent wrong answer was mine.

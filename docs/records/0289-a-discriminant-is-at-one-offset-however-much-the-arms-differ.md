# A discriminant is at one offset, however much the arms differ

A discriminated union is written with the discriminant declared first in every
member — that is what makes it discriminated. So `kind` sits at offset zero in
all of them, however much they disagree about everything after it:

    class Left  { kind: "l"; n: number }
    class Right { kind: "r"; s: string }

    value.kind    ->  `kind` on a union, whose members lay their fields out
                      differently

The refusal was the right answer about the **union** and the wrong one about the
**field**. The union genuinely has no single representation and erases; the
field genuinely is at one offset.

## The licence already existed twice

Nothing new had to be invented, which is the useful part. `laid_out_as_a_prefix`
already states the rule for a cast — fields agreeing in name, order and
representation means a load lands at the same offset either way — and
base-first layout already relies on it for every subclass. This is the third
place that same sentence is true, and it is now written once and read three
times rather than argued again.

Two facts make the read cheap. `Unerase` is a **reinterpretation**, not a
checked cast. And the tag an erased object carries is coarse — every object has
the same one, because the tags are spelled as `typeof`'s answers. So no
discriminant is tested to do this:

    export func unionField(value: erased) -> managed<str> {
      %1 = unerase %0 : managed<obj#1>
      %2 = field.get %1.0 : managed<str>

## Reading through an arm, not through a synthesised type

The obvious shape is a synthetic layout holding exactly the shared prefix, and
it is the wrong one. `layout_of` is **not a query** — it creates a layout for a
type that has none and pushes it into the function's list, and materialising one
changed the emitted program badly enough to break six modules the last time
(see `laid_out_as_a_prefix`, where the same trap is recorded from the other
direction). A representative arm needs nothing new to exist.

`members[0]` is that representative. Every arm must have a layout, which is also
exactly the test for whether an arm can hold a field at all — an arm that is
`null`, `undefined` or a primitive answers `None` and the read stays refused
rather than becoming a load from a tag.

## What the check has to be, and what a weaker one would do

`same_slot` — names **and** representations. A rule matching on names alone
passes this:

    class A { at: number; tail: number }
    class B { at: string;  tail: number }

and emits a load at offset zero that reads a `double` out of a slot holding a
pointer. Nothing refuses and nothing crashes; the answer is a number made of a
pointer's bits. That is the worst failure mode available here, so it is a
fixture rather than a comment.

The agreement is a **prefix and not a set**. `tail` above agrees in both arms
and is still refused, because field 0 does not agree and nothing after an
disagreement sits at a known offset. Reaching it would need the discriminant
tested and one load per arm, which is a different feature — and there is no
discriminant to test, for the same reason the read is cheap.

## Where the halves live

The positive cases are `examples/a-member-every-arm-puts-in-the-same-place` and
the refusals are `blockers/union-members-lay-fields-out-differently`, and the
split is forced rather than stylistic: a refused function leaves the
differential silently, so an example holding both would report agreement over
whatever lowered and go green having stopped testing the two it was written for.
That is the same trap record `0287` hit from the other side, twice in one day.

The example's load-bearing function is `bothArms`, which reads the discriminant
from a `Left` **and** a `Right` in one answer. Reading only one arm would pass
while being wrong about the other, which is precisely what this feature is
capable of getting wrong.

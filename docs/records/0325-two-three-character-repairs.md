# Two three-character repairs, both measured, both reverted

A property typed exactly `null` has no representation. `representation_of` has
had an arm for `undefined` for as long as it has existed and has none for
`Null`, and it is a **root**: 9 things across 9 modules refuse under its own
message, and behind that an arm of a discriminated union carrying `value: null`
has no layout, so reading the *discriminant* refuses too.

Both repairs are three characters. Both work. Neither landed.

## The first: `TypeKind::Null => HirType::Erased`

```text
examples   201 of 201 agree, C, LLVM and the JVM
refusals   util −15, net −18, assert −16, stream −19
sweep      FAILED
```

```text
error: passing 'NtsString *' to parameter of incompatible type 'NtsValue'
  v26 = nts_value_tag(v18);            in field_s_null
```

Twelve lines reproduce it:

```ts
class Held { f: string | null; constructor(v: string | null) { this.f = v } }
const b = new Held(n > 0 ? "a" : null);
const before = String(b.f) + String(b.f === null);
b.f = null;
return before + "|" + String(b.f) + String(b.f === null);
```

After `b.f = null` the checker **narrows** `b.f` to type `null`. A blanket
erased representation then sends the conversion down the tagged path while the
storage is still a pointer.

So the missing arm is not an oversight. `null`'s representation depends on what
it is standing in for — a pointer's spare bit pattern where there is a pointer,
a tag where there is not — and a function that answers per *type* has no single
right answer to give. The hole was load-bearing, and the thing that says so is
not in `representation_of` but in the narrowing three files away.

## The second: reading a `Void` contextual type as erased

This fixes the twin case — `value: undefined`, and `return undefined` from a
`void` function, both refused today.

```text
examples   201 of 201 agree, all three backends
addons     12 of 24 still build, 12 REGRESSED
           refusing to emit code from invalid HIR
           NotDominated { func: "Closure48#call__resume", … }
```

**It does not introduce that.** The refusal stood in front of a generator-resume
path where a value crosses a `yield` without being placed in the frame, and
removing it was the first thing ever to compile that path.

That is the second load-bearing over-refusal this week. The other was
`for (var i = …)`, kept out of a closure-capture narrowing by a rule that never
asked which keyword wrote the declaration, and recorded at the time as an
over-refusal "costing nothing" ([[0318]]).

## What the two have in common, which is the record

Each was correct about the thing it was aimed at. Each was wrong about something
three files away that no reading of the diff would reach. And each was caught by
a **different** step:

```text
probe      the construct refuses           -> build it
examples   201 of 201, three backends      -> it works
sweep      a tag read on a pointer         -> repair 1 is wrong
addons     12 of 24, invalid HIR           -> repair 2 is wrong
```

Examples agreed for both. The corpus and the generated cross-product disagreed,
for different reasons, and neither could have caught the other's: `sweep` writes
programs nobody would write, and `addons` compiles programs somebody wrote to do
a job — which is where the generators are.

**A three-character diff is not a small change; it is a small diff.** The two
are unrelated, and the only thing that distinguishes them is running the whole
gate rather than the part that is about the feature.

## What was landed instead

Nothing, and `blockers/a-property-typed-exactly-null` with both measurements in
it — including what the fix actually needs, which is for the contextual type at
the literal to come from the **layout** the field path already decided rather
than from the checker a second time. Two derivations of one fact, disagreeing in
the gap between them, and closing that is not three characters.

The example written for the first repair was deleted with it. A fixture for a
feature that did not land is a fixture that passes for the wrong reason.

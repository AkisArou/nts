# A message that cannot name its cause, and an answer that did not refuse

Two findings from one afternoon, and they are the same shape from opposite
sides: a refusal that could not be decomposed, and a wrong answer that produced
no refusal at all.

## The refusal that named no type

    a conversion to string from this type

178 sites in `runtime/node`, and **no census could say what they were**. An
object wanting `ToPrimitive`, an array wanting `Array.prototype.toString`, and an
erased value wanting a tag dispatch are three different features, and that
sentence covers all three without distinguishing them. The ledger row for it
reads "`ToPrimitive`, `OrdinaryToPrimitive` — `valueOf`/`toString` dispatch",
which is a reasonable guess at what 178 sites must be, and it is wrong.

`describe(snapshot, ty)` already existed; `unrepresentable` already used it. One
line put it in the message. The answer arrived in one pass:

    176  unknown
      2  a union of an object | null
      1  a union of an array | number | string

and **161 of the 176 are in `internal/errors.ts`**, template literals
interpolating an `unknown` into an error message. So the work behind that row is
`ToString` of an **erased value** — a dispatch on the runtime tag — and not
`valueOf`/`toString` dispatch on a typed object. Nothing about the row's stated
subject was going to clear it.

**A diagnostic is an instrument, and one that cannot distinguish its own causes
has the same defect as `grep -c` counting a pattern that does not match.** Both
produce a usable number. Neither produces a true one.

## The answer that refused nothing

`new C(n)`, where `C` is a value holding a class.

The constructed type came from the *expression's* type, which the checker takes
from the callee's declared type. So `function make(C: typeof Thing)` built a
`Thing`, called `Thing__constructor`, and discarded the class argument:

    static int32_t make(NtsObj_Fn2__1 * v0, int32_t v1) {
        (void)v0;
        v2_frame.header.descriptor = &nts_desc_NtsObj_Thing__Thing;
        Thing__constructor(v2, v1);

`Other`'s constructor was never emitted, and its descriptor read
`sizeof(NtsObj_Thing)` under the name `"Other"`.

**One class through the site is correct, and that is the whole reason it
survived.** The probe that found it is two arms differing in one thing:

    oneClass    make(Thing, n)                               agreed, 0 of 29
    twoClasses  make(Thing, n) * 100 + make(Other, n)        disagreed, 18 of 29

My first probe had one arm, agreed on every case, and I reported to the user that
this queue item was "mostly already built". An hour earlier I had written
`twoGeneratorsOneWalk` into a fixture of my own with the comment *"two shapes
through one site is the only arrangement where that is a different number rather
than an invisible bug"* — and then tested a class value with one shape.

## Both were already written down

The class-token lowering says, in its own comment:

> `new` through such a value is a separate feature and **still refuses**, as "a
> computed constructor".

It does refuse a *computed* callee: `new things[0]()` has no identifier text. A
**named** binding has text, so it was resolved by name and never reached the
check. The comment was true of the case its author had in mind and false of the
one beside it, and nothing tested the difference.

That is the same mechanism as record 0296's `declares_field` fallback, whose doc
stated the precondition it relied on and became wrong when something else
falsified it. Here the sentence was never false about computed callees; it was
just never true about named ones.

## What changed

The refusal now matches the sentence. `ordinary` and `comparedOnly` are the
controls — naming a class directly still works, and holding one in a value to
*compare* still works, which is the half the ledger was right about.

Cost, measured before keeping it: 29 sites in `runtime/node`, **24 of 24 addons
still build, 0 regressed**. Refusals went *down*, 20557 to 20509, because
refusing at the `new` stops a cascade that used to run past it.

It also cost the provably-monomorphic case — `const C = Thing; new C(n)` is
refused now and was correct before, and `blockers/class-as-value` was the guard
that said so. That fixture had **two claims under one `expect: lowers`**: a class
reaching a value position, which is what it was built for and still works, and
constructing through one, which it could not have caught going wrong — its
registry holds exactly one class, so the correct program and the broken one
construct the same thing and `lowers` was true either way. The construction half
moved to its own fixture; the guard keeps guarding what it was for.

Losing that case is the trade this project's own rule makes: a wrong answer that
runs is worse than a missing feature, and nothing available here could tell the
monomorphic case from the broken one. Building it properly needs the token to
carry the instance descriptor and the constructor, which is `0296`'s resumption
slot with a different member — and the JVM lane reports that the same change
would close `a-class-stored-and-compared`, its last failing example, because a
token that is a layout with a slot can have a base and a base is what that
backend needs to relate it to the signature its `typeof` names.

Two ledger rows were wrong in opposite directions and both are corrected. The ✅
row claimed `err.constructor === TypeError` works — it is refused. The ✗ row said
a class passed or returned does not work — passing and returning are fine, and
*constructing* was silently wrong rather than missing.

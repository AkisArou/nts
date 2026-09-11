# A discriminant is at one offset, however much the arms differ

A discriminated union is written with the discriminant declared first in every
member — that is what makes it discriminated. So `kind` sits at offset zero in
all of them, however much they disagree about everything after it:

    class Left  { kind: "l"; n: number }
    class Right { kind: "r"; s: string }

    value.kind    ->  `kind` on a union, whose members lay their fields out
                      differently

The refusal is the right answer about the **union** and the wrong one about the
**field**. The union genuinely has no single representation and erases; the
field genuinely is at one offset.

This was built, landed, **reverted the same evening**, and landed again in a
different shape. The reversion is the useful half of the record.

## What worked, and on which machines

On C and LLVM the read is free. A pointer cast between two structs with a common
initial sequence is exactly what base-first layout already relies on for every
subclass, `laid_out_as_a_prefix` already states the rule for a cast, and
`Unerase` is a **reinterpretation** against a tag that is coarse — every object
carries the same one, because the tags are spelled as `typeof`'s answers. So no
discriminant is tested to do this:

    export func unionField(value: erased) -> managed<str> {
      %1 = unerase %0 : managed<obj#1>
      %2 = field.get %1.0 : managed<str>

Sixteen cases agreed with node, including the exhaustive `switch` that
`typescript.md` had carried as struck-through and audited-blocked.

**The JVM cannot do it, and does not fail quietly:**

    java.lang.ClassCastException: class nts.gen.Right cannot be cast to
    class nts.gen.Left

Seventeen aborts in one example. `Unerase` becomes a `CHECKCAST` there and the
class is checked.

## Why it came out rather than staying

The JVM floor absorbed it — 168 against a floor of 167 — and that is the
argument for reverting, not against it. A floor one below the count cannot see
one regression. A throw is loud on one lane and only if somebody looks; a
refusal is loud on all three. The JVM lane made the call in one sentence I had
handed them myself, and they were right to use it.

The alternative they raised and rejected is worth keeping too: raising their
floor to 168 would turn their step red until the op lands, blocking three
sessions on a construct none of us is working on today.

**Documenting a throw in three places does not change what the gate reports to
whoever runs it next.** That is the whole reason "I wrote it down" was not
enough here.

## The shape it came back in

The HIR said *reinterpret*, which is an instruction. One machine can execute it
and one cannot. So the op has to state the **fact** — these arms agree about
this field — and let each backend choose. That is the third time this month the
answer was to move a statement about the machine up into a statement about the
program, after `declared_by` and `ClassIdentity`.

The JVM lane measured the two candidates rather than agreeing with my guess,
over 3000 mixed elements and three arms:

    instanceof chain        1759 ns/pass
    synthesised interface   6213 ns/pass    3.5x slower

An interface makes every read a megamorphic `invokeinterface` whose itable
lookup defeats inline caching, and it would change the arms' class shapes. The
chain stays branch-predictable and its field loads inline.

So the op carries **the arm type ids and the field index**. Not a field name:
the name is per-arm on the JVM even where the precondition makes them equal, and
one fact with two derivations is the error this compiler keeps repeating. C and
LLVM emit the pointer read they already would; the JVM emits one `instanceof`,
one `checkcast` and one `getfield` per arm.

The precondition is the op's entire contract, and it is one sentence both halves
can be checked against: **every arm agrees about name, index and
representation.** It is what makes the C read sound and what makes the chain
sound.

## What the check has to be, and what a weaker one would do

`same_slot` — names **and** representations. A rule matching on names alone
passes this:

    class A { at: number; tail: number }
    class B { at: string;  tail: number }

and emits a load at offset zero that reads a `double` out of a slot holding a
pointer. Nothing refuses and nothing crashes; the answer is a number made of a
pointer's bits.

The agreement is a **prefix and not a set**. `tail` above agrees in both arms
and must still be refused, because field 0 does not agree and nothing after a
disagreement sits at a known offset.

## What it is

    OpKind::SharedFieldGet { value: ValueId, arms: Vec<TypeId>, field: u32 }

    %14 = field.get.shared %11.0 over obj1 | obj7 : managed<str>

C and LLVM emit the pointer read they already would. The JVM emits its chain,
and until that half lands it **declines the op by name** — which is the entire
difference from the first attempt. A decline is a refusal a reader can see; a
`ClassCastException` inside a floor that absorbs it is not, and that was the
whole of the JVM lane's objection.

The last arm still takes its own test rather than being a fallthrough. A value
matching none of them is a program the checker should have rejected, and what
happens there is a named refusal — `NtsRuntime.unreachable()`, four bytes on the
JVM — rather than a cast nobody chose.

`examples/a-member-every-arm-puts-in-the-same-place` guards the positive cases
and `blockers/union-members-lay-fields-out-differently` holds the two that must
go on refusing. The split is forced rather than stylistic: a refused function
leaves the differential silently, so an example holding both would report
agreement over whatever lowered and go green having stopped testing the two it
was written for.

## The rule the two lanes agreed on, which outlives this construct

**The lane that makes a construct work is the lane that moves its own floor.**
Not the lane that adds the example. That is the only arrangement in which the
number means something to the person who moves it — and it is the inverse of
what happened here the first time, where I added an example and left another
lane to discover it throwing.

# Three green instruments and five broken modules

The positional-rest work (`0287`) and the `.apply` work (`0288`) were committed
behind this:

    corpus       184 cases, invalid HIR 0
    blockers     154 fixtures, 154 as expected, 0 needing a person
    examples     173 of 173 agree with node

All three true, all three green, and `dgram`, `fs`, `http`, `net` and `process`
would not emit at all:

    StoreType { func: "defaultTriggerAsyncIdScope<[obj12236]x2,void>",
                what: "an array element read",
                expected: Erased, found: Managed(Object(TypeId(12237))) }
    Error: refusing to emit code from invalid HIR

Five of twenty-three floor modules, and **nothing I ran locally could have seen
it**.

## The population, not the instrument

None of the three is broken. Each covers what it covers, and the shape that
broke needs a **generic rest whose instantiation is heterogeneous** — two
positions that represent differently, so the tuple's element type erases. The
corpus is single-file cases. The blockers are reductions. The examples were
written for the constructs, and every rest example I had used positions of one
type, because that is what you write when you are demonstrating a rest
parameter.

So the gap was not "an instrument that cannot fail". It was an instrument whose
**population did not contain the case**, which looks identical from the outside:
green, fast, and about something else. `count-what-the-instrument-could-not-run`
is the sibling and it announces itself with a zero; this one announces itself
with a full pass.

## What the defect was

A tuple whose positions disagree is an array of `Erased` (record `0285`).
Expanding a spread into positional arguments, I typed the `ArrayGet` at what the
**position declares** rather than at the **array's element type** — so the read
asserted a concrete object came out of an erased slot. Homogeneous
instantiations kept a concrete element type and were accidentally correct, which
is why `timers` passed and `fs` did not, and why every local test passed: they
were all homogeneous.

The fix reads at the array's element type and unerases afterwards, licensed by
the position's declared type — which is what `element_of` already does for a
tuple index, and was the third time this week the answer was already written
somewhere else.

## Two `StoreType`s that are not the same defect

Worth keeping, because I asserted one about the other:

    nextTick<obj24>                  what: "a field"                pre-existing
    defaultTriggerAsyncIdScope<…x2>  what: "an array element read"  new

Both `StoreType`, both naming a generic copy, both mentioning `Erased`. I had
A/B'd the first against `HEAD` twice and correctly concluded it was not mine,
then generalised that to a message the Node lane read as covering the second.
**The A/B was sound about the thing it tested and silent about the thing it did
not.** A fixture that does not contain a shape cannot exonerate a change with
respect to it.

## What changed

`examples/a-fixed-arity-rest-is-positional` gained `heterogeneousForward` and
`mixedForward`, and they were checked the only way a guard can be: by putting
the bug back and confirming they reproduce the addons' exact message. They do.

And `addons.sh` runs locally before a commit that touches lowering, not a gate
later. It costs eight minutes. Finding this through the gate cost a full
twenty-minute run of a resource three sessions queue on, plus the Node lane's
time — they found it independently, from the other side, while I was still
reading my own log.

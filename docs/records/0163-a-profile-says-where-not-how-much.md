# 0163 — A profile says where, not how much

Four hypotheses about one row, four instruments, four refutations, and no
rewrite spent on any of them. `symbol-keyed-map` is 3.35x hand-written Java and
after all of it the row is 3.29x and the cause is upstream.

## The four

**Allocation.** Two `NtsValue.ofObject(symbol)` wrappers per iteration to look a
key up. `NTS_BENCH_ALLOC=1`: **368 bytes an operation against the reference's
312.** Scalar-replaced, exactly as record 0149 found for five other rows and as
record 0156 found for `map-and-set`'s numeric keys an hour before. One run.

**The boxed key.** `NtsMap` stores `NtsValue[] keys`, so a probe is `buckets[p]`,
then `keys[slot]`, then that box's `.ref` — three dependent loads where
`IdentityHashMap` compares a reference it already holds against one. The same
probe written twice, four entries and 8,192 lookups, differing in nothing else:

| | instructions/call | cycles/call |
| --- | ---: | ---: |
| key inline in the table | 423,292 | 72,990 |
| key behind a box | 426,401 | **75,722** |

**3.7%.** The extra load is real and nearly free, because four boxes are
L1-resident and the loads pipeline. One probe, and the `NtsMap` rewrite it would
have justified never happened.

**The linear scan.** `async-profiler`, which is where I should have gone two
hypotheses earlier:

    52.14%  nts.rt.NtsRuntime.toInt32
    20.64%  nts.rt.NtsMap.findLinear
     8.17%  nts.gen.Program.work$whole
     5.60%  nts.rt.NtsMap.sameKey

`NtsMap` walks insertion order below eight live entries instead of hashing, and
this table has four. Setting the threshold to zero so every lookup hashes:
**3.35x to 3.29x. Two percent.** `map-and-set` 1.85 to 1.84 and `array-from`
unchanged, which is the control — both are past the threshold and a change to it
should do nothing to them, and did.

Reverted. Always hashing also allocates a `long[]` for every map that never
grows past a handful, and two percent on one row does not buy that. The number
is in the constant's own doc comment, where the next person to wonder about the
threshold will be standing.

## What the fourth one is really about

**The profile was right about the location and wrong about the prize**, and that
is the third instrument to do this today:

| instrument | said | was worth |
| --- | --- | ---: |
| `NTS_BENCH_ALLOC` on `map-and-set` | 65,952 bytes is the keys | the keys the table *keeps*; the change cost 0.23x |
| conversion count in emitted C (nts-69's) | 7 to 1 | 2 to 7 in machine code; zero |
| `async-profiler` on `findLinear` | 20.64% | **2%** |

Each is a correct measurement of an adjacent quantity. The allocation counter
says how many bytes survived, not how many objects the program wrote down. A
conversion count in the IR says what the IR contains, not what the backend
emits. **And a profile says where the cycles are, not which of them a change
would remove** — `findLinear` really was a fifth of the row, and hashing costs
nearly the same, so almost none of that fifth was recoverable.

The generalisation that covers all three: *an instrument measures a quantity,
and a change removes a difference.* Nothing about the first tells you the
second.

**That is true and it stops one step short**, and nts-69 supplied the step,
which is the actionable half. The reason the difference was smaller than the
quantity in every one of the three is the same reason:

> Each prediction assumed the saving equals the measured quantity. That is only
> true if **the replacement is free**.

- 65,952 bytes were real; the replacement was a second probe on every insert,
  and C2 was already removing most of the allocations.
- Seven conversions were real; the replacement was two static helpers that clang
  then inlined, which cost five more conversions than it saved.
- 20.64% in `findLinear` was real; the replacement was hashing, which costs
  nearly the same and allocates a `long[]`.

So the rule is a thing to do rather than a thing to know:

> **Price the replacement before you build it, not the thing you are
> removing.**

**Superseded twice, and this rule is the weakest of the three.** Record 0165
added the missing factor -- the saving is `share x (1 - replacement/original)`,
and this record computes the second while assuming the first is 1. Record
**0172** added the one that matters most and is not visible from here at all:
*mutating the reference prices the shape in the **reference's** context.* Both
of `array-methods`'s numbers were measurements -- 22.8% predicted from the
mutated reference, 4.7% measured in our own code -- so the method was sound and
only the context differed. A rule that says "price it" cannot catch that; a rule
that asks **where** it was priced can.

Read 0165 and 0172 with this one. What is written below is true and incomplete.

It costs one sentence — you already have to say what the code will look like
afterwards — and it would have killed all three predictions at the desk. It also
answers *which* changes deserve an A/B, which "always A/B" does not: if you can
price the replacement and it is small, build it; if you can price it and it is
not, you are done without building; only when you genuinely cannot price it does
the experiment earn its run.

And the corollary, which is the failure mode of the rule itself and the reason
this step gets skipped:

> **An instrument that measures the thing being removed can never see the
> replacement.**

An allocation counter cannot see a probe. A conversion count cannot see an
inlining decision. `async-profiler` on `findLinear` cannot see what a hash costs
in a function that does not exist yet. The replacement's price is never
available from the instrument that motivated the change; it always has to come
from somewhere else.

## What is left, and whose it is

Half the row is `| 0`. The case writes
`total = (total + (events.get(key) ?? 0)) | 0`; the map's value type is
`number`, so `nts_map_get` hands back an erased f64, the add is an f64 add, and
the `| 0` is `cvttsd2si` — four to six cycles on the accumulator's serial
dependency chain, where the reference's `int` add pays one and *is* ToInt32.

`ToInt32` is a semantic operation and not a representation change, so no backend
pass may elide it. What could is a range proof: the stored values are 1 to 4 and
the total is bounded by 4096 x 8, so the wrap provably never happens. That is
`hir`'s and it is filed there with the number.

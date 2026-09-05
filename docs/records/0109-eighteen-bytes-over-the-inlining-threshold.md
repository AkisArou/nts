# 0109 — Eighteen bytes over the inlining threshold

`awfy-bounce`, 1.57x hand-written Java after five candidates were priced and
refuted. The cause is a step function, and one flag shows it:

| | ns/op | vs reference |
| --- | ---: | ---: |
| ours, default `FreqInlineSize=325` | 7878.3 | 1.65x |
| ours, `FreqInlineSize=400` | **5045.1** | **1.06x** |
| hand-written Java | 4770.6 | 1.00x |

`-XX:+PrintInlining`:

    ours        nts.gen.Program::Ball$bounce (343 bytes)   hot method too big
    reference   Bounce$Ball::bounce          (144 bytes)   inline (hot)

**343 against a threshold of 325.** Eighteen bytes decide whether the method is
inlined into its caller or called 5,000 times per operation, and that decision
is 1.56x of a 1.65x gap.

## This reconciles 0102, which is the part worth keeping

Record 0102 measured constants out of slots -- 196 → 160 bytecodes on
`generator`'s per-element body -- and the time did not move **at all**. Its
conclusion, "bytecode volume is not the currency", is correct *linearly*: C2
erases slot traffic, dead stores and redundant jumps, so removing them buys
nothing directly.

It is also why five separate candidates each measured ~0 on this row:

| candidate | direct cost | bytes |
| --- | ---: | ---: |
| definite-assignment prologue | **0** (4.57 against 4.57) | ~57 |
| redundant `goto`s | ~1% | 7 × 3 |
| materialised boolean | none to remove | -- |
| slot traffic | 0, per the prologue test | large |
| bytecode volume generally | 0 | -- |

**Every one is free to execute and none is free to inline.** The prologue is
the clearest case: nineteen dead stores that C2 removes entirely, which no
profile will ever attribute a cycle to, and which are ~57 bytes of the 343 that
put this method over the line.

So the rule is not "volume does not matter" and not "volume matters". It is:

> **Emitted size is free until it crosses an inlining threshold, and then it is
> worth more than anything else on the row.**

A linear experiment cannot find a step function. 0102 ran the right experiment
and drew the only conclusion its data supported, and the conclusion was
incomplete in a way that made the next five experiments look like dead ends.

## What this makes worth building, and why the reason has changed

The plan lists slot reuse by live range, fusing block-parameter copies and
eliminating the prologue, and prices them against the eighty-line StackMapTable
design. 0102 said not to build them: they save instructions that cost nothing.

That was right and the justification is now different. They are worth building
**as a byte budget**, for methods near 325, and the prologue is the cheapest
~57 bytes on the table. It costs nothing to execute, which is exactly why no
profiler and no cycle count would ever have pointed here.

The mechanism for dropping it: a slot needs a default only where the verifier
could otherwise see it unassigned at a frame. Declaring fewer slots per frame
needs `hir::liveness` and gives up the one-full-frame-then-`same_frame` design
that made this backend tractable -- a real cost, now with a real number
against it.

## What the measurement is not

`FreqInlineSize=400` is a diagnosis, not a fix. The plan is explicit that a
number needing a flag is a number about the flag, and this backend ships on
whatever JVM it is handed -- including ART, whose thresholds are its own. The
fix is to emit a method that fits.

## The first attempt at the byte budget, and why it was reverted

The prologue is the cheapest ~57 bytes, so: declare a slot `Top` when its value
never crosses a block boundary, on the reasoning that the verifier reads such a
slot's type from the store preceding every use inside the block, and a frame
never has to name it. `VType::Top` already exists for exactly this and
`initialize_locals` already skips it.

It worked on the metric it targeted. `Ball$bounce` went **343 → ~256 bytes**,
prologue stores **19 → 1**, comfortably under 325.

**And the gate fell from 96 to 35.**

    nts/gen/Program.addWrapsAtInt32$whole(I)I @37: iload
    Reason: Type top (current frame, locals[7]) is not assignable to integer
    locals: { integer, integer, integer, top, top, top, top, top, top, top }

An `iload` of a slot the frame declares `top`, with no store before it in that
block -- so the value *was* written in an earlier block and read in a later
one, which is precisely the case the liveness query was supposed to exclude.
The premise is sound and the set computed from `live_in`/`live_out` does not
match the emitted frames. Reverted rather than patched: the idea needs the
right liveness question, not a guard on the wrong one.

Worth separating two things the failure does **not** touch:

- The diagnosis stands. `FreqInlineSize=400` takes this row from 1.65x to
  1.06x, which is a measurement of the JVM's behaviour and not of this change.
- The direction stands. The prologue is still ~57 free-to-execute bytes on the
  wrong side of a threshold, and it is still the cheapest thing to remove.

What this cost is one build and one gate, and what it bought is knowing that
`hir::liveness`'s answer and the emitted frames' requirement are not the same
question -- which is the thing to establish before the second attempt rather
than after it.

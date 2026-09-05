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

## The second attempt, which was closer and wrong in a more interesting way

If `hir::liveness` answers a different question, ask the emitter's question
directly. A frame sits at every block head, so a slot needs a declared type
there only if a later instruction can read it without this block having written
it: the value is a block parameter, or it is read in some block other than the
one defining it. Computed from `func.blocks` in twenty lines, no dependency on
what `live_in` means.

`Ball$bounce` went **330 → 261** (last bci), `bitwise` and `awfy-bounce` both
verified under `-Xverify:all`, and `examples/nullish` failed to verify:

    nts/gen/Program.erasedFallback(D)D @69: iload
    Reason: Type top (current frame, locals[6]) is not assignable to integer

**A near-miss is the dangerous shape.** A wrong premise that breaks everything
announces itself. One that breaks a handful looks like a list of special cases
-- and a list of special cases is what a wrong general rule produces, so the
temptation is to find them and add guards. Two rounds of reasoning about which
values cross had produced two wrong answers, so the third round was a `javap`
dump instead:

    46:  iload  11        <- block head, frame here
    48:  istore 6         <- slot 6 written
    53:  if_icmpeq  62    <- a comparison materialises
    62:  iconst_1
    63:  istore 11
    65:  iload  11        <- branch target, FRAME HERE
    67:  istore 7
    69:  iload  6         <- slot 6 read, across that frame

Four instructions, and the premise is gone. **A frame does not sit only at
block heads.** Turning a comparison into a 0 or a 1 branches *inside* a block,
so a value defined and read within one HIR block can still cross a frame.

The emitter had already written this down. `materializes()` describes its own
subject as

> the only thing that needs a scratch slot and **the only thing that puts a
> label inside a block**.

That comment is load-bearing and I had read it while extending the function
beside it. Two hypotheses about which values cross a frame were formed without
consulting the one sentence in the file that says where frames are.

## What worked

The question is asked per **op index** rather than per block: a value is `Top`
only if every read of it is in its own block with no materialising op between
the definition and the read. Fusion is ignored deliberately -- a fused
comparison emits no label, so counting one costs a slot its `Top` and never
costs soundness. It lives in `crossing_values`, beside `unbox.rs`, because an
analysis with a wrong premise twice should be a named function with the premise
in its doc comment rather than twenty lines inside `Emitter::new`.

`bounce` **330 → 261** -- the whole of the coarse version's win, because an
arithmetic method materialises few comparisons.

## The order the three attempts should have gone in

1. `javap` the frames.
2. Form the premise from what the frames do.
3. Build.

They went 3, 3, 1. The first two attempts cost a build and a gate each and the
dump that settled it took under a minute. **The failure was not the wrong
premise; it was two premises formed without looking, when looking was cheap.**
`-Xverify:all` caught both, which is the argument for it being in the loop
always -- but the verifier tells you a frame is wrong, not why, and the why was
one command away the whole time.

## The gate numbers in this record were measuring the wrong binary

Written down because it nearly cost more than the wrong premises did.

`tooling/gate/all.sh:320` runs `"${NTS_BIN:-./target/release/nts}"`. This lane
builds with `CARGO_TARGET_DIR=target-jvm`, and `NTS_GATE_STEPS="jvm"` skips the
`build` step -- so without `NTS_BIN` the gate drives `target/release/nts`, which
in a checkout shared by three sessions is **whatever another session last built,
from a working tree containing this session's uncommitted edits at that
session's build time.**

The tell was a third run reporting 88 of 100 with twelve examples "not
agreeing", every one of which passed `nts check` and `-Xverify:all` against the
binary this session had actually built.

So it is not a stale constant. It is a number that *moves when you change
things*, in roughly the direction you expect, while measuring something else. A
frozen number would have been caught immediately.

**"It responds to my edits" is much weaker evidence of measuring my edits than
it feels like** -- and it is the same failure as the near-miss above, one level
down: a result plausible enough not to look at.

What survives is what was established without the gate. Both `VerifyError`s were
reproduced by hand, with `-Xverify:all` on this session's own binary, and their
frames read in `javap`. That is the whole reason the two refutations above are
still refutations rather than a second thing to redo. The floor numbers quoted
in the two attempts are not evidence of anything and are left in place only as
the story of how the instrument was caught.

The plan already said this, in a section about three sessions sharing a
checkout: *"a hard-coded path can measure someone else's binary and report a
floor for code nobody is looking at."* It was read and not applied, which is the
third time in this record that a written-down fact was walked past.

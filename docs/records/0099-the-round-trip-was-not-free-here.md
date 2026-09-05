# 0099 — The round trip was not free here

**1.53x more instructions per operation than hand-written Java, for the same
program, at higher IPC.** `awfy-bounce`, and it settles a prediction this plan
made and never checked.

## The prediction

> **The `store`/`load` round trip.** Every value goes to its slot and comes
> back. C2 removes it, exactly as `mem2reg` removes the C backend's
> equivalent — record 0004 measured that at parity and called emitting
> "simple, regular, obviously correct" code "measurably free". **Justified
> only if a profile disagrees.**

The profile disagrees.

## The measurement

A fixed-count driver — 20,000 warmup then exactly 200,000 operations, no
calibration — because record 0049 already recorded why the ordinary harness
cannot answer this: it is time-budgeted, so two binaries run different
iteration counts and their instruction totals do not compare. All three
variants return the same checksum, so they did the same work.

| variant | ns/op | instructions/op | IPC |
| --- | --- | --- | --- |
| nts (JVM) | 7807.2 | **265,735** | 5.36 |
| hand-written Java, `int` fields | 4776.6 | 185,940 | 6.02 |
| hand-written Java, `double` fields | 5438.0 | **173,724** | 4.95 |

Against the variant it should be compared with — the reference with only its
four `Ball` fields changed from `int` to `double`, which is what a TypeScript
`number` is — this backend executes **1.53x the instructions** and recovers
**1.08x** of it through better IPC. 1.53 / 1.08 = 1.42, and the measured time
ratio is 1.44.

## The row, decomposed

    field width      1.14x   (int fields -> double fields, reference vs itself)
    instruction count 1.44x   (double-field reference -> this backend)
    product          1.64x
    observed         1.63x

Two causes, and the codegen one is the larger.

## What this rules out, which is most of what I would have guessed

**Not stalls.** The obvious story for a compiled-language backend losing to a
hand-written one is that it chases pointers and misses cache. IPC says
otherwise: **5.36 against the reference's 4.95**. This lane runs *better* per
cycle than the thing it loses to, which leaves only instruction count.

**Not the by-value storage that explains the C++ gap.** Record 0049 has this
row at 1.56x against C++ because the C++ reference holds balls in a
`std::array<Ball, N>` where we hold references. Java has no value types —
`Ball[] balls = new Ball[ballCount]` is an array of references exactly like
ours — so that lever cannot touch this column. Suggested as one cause and
refuted by reading two source files.

**Not the checked index.** `javap` finds zero calls to `NtsRuntime.bounds` in
the emitted program. Record 0094 has that costing 4.6x on `awfy-nbody`; it is
not present here.

**Not the hot method.** `Ball$bounce` calls nothing but `java.lang.Math.abs`,
four times, which is a JIT intrinsic.

**Not the prologue.** The definite-assignment stores are once per call, and
each call runs 50 x 100 bounces, so they are a five-thousandth of the work.

## How much C2 does recover, which is the number that decides the fix

The interpreter executes bytecode literally — nothing eliminated, nothing
allocated to registers — so the same program run under `-Xint` measures
**emitted bytecode volume**, and the compiled run measures **what survives
C2**. The two together separate "I emit too much" from "C2 fails to clean it".

| | nts (JVM) | Java, `double` fields | ratio |
| --- | --- | --- | --- |
| interpreted, `-Xint` | 661,828 ns/op | 222,861 ns/op | **2.97x** |
| compiled | 8,040 ns/op | 5,521 ns/op | **1.46x** |

Stable across 150, 300 and 900 operations — ratios 2.83, 2.87, 2.97, with the
per-operation cost drifting under 7% — so this is not startup being amortised.

**So C2 recovers a factor of about two, and it is the emitter that hands it
2.9x the bytecode to start from.** Both halves of that matter and they point
in opposite directions:

- The round trip is *not* free, which is what this record is about.
- But it is not full price either. A change that halved the emitted bytecode
  would not halve the gap, because C2 is already recovering most of that
  ground and would simply have less to recover.

That is the number that decides whether slot reuse by live range is worth its
cost — it buys back at most the residue, not the 2.9x — and it is why the
honest next step is attribution rather than picking the most satisfying
candidate from the list below.

## What is left, and why the C backend's answer did not transfer

Record 0004 is about C, and `mem2reg` runs over an entire function with the
whole SSA graph in front of it. C2 is a JIT with an inlining budget and a
compilation deadline, and what it sees is the *bytecode* — where a block
parameter is a real store to a real local and a real load back, and there are
a great many of them. Reading `Bounce$benchmark`, the loop's tail is nine
load/store pairs to move six values across one edge.

The conclusion is not that C2 is bad at this. It is that **"the other
backend's optimiser removes this" is not evidence about a different optimiser
on a different IR at a different time**, and this plan treated it as though it
were. Same shape as the error one level up: `hir::escape` proves something,
C2 also does it, and neither fact implies the other.

## What would move it

Named, not chosen — the next thing is to attribute the 1.53x between the
candidates rather than to pick one.

- **Slot reuse by live range.** `hir::liveness` exists. It costs the
  eighty-line stack-map design, since frames become per-block again.
- **Fusing the block-parameter copies.** `edge_copies` and `destruct` already
  compute what moves across an edge; the copies are emitted through slots
  rather than left on the stack.
- **The materialised boolean**, where a comparison is stored rather than
  branched on.
- **Field specialization**, which is upstream and worth 1.14x here on its own.

  I read the four `double` fields on both lanes and wrote that "number
  specialization narrows locals and not fields". **That was wrong**, and the
  wrong half is the informative one: it narrows fields perfectly well —
  `Random.seed` in the *same program* is an `int32_t`. What it could not
  narrow is a field whose value **depends on itself**. `fields` was seeded
  empty in the interprocedural fixpoint, an absent entry reads as TOP at the
  use, so round one saw `this.x` as TOP, computed `this.x += this.xVel` as
  TOP, published TOP, and every round after agreed.

  `Random.seed` escaped only because `(seed * 1309 + 13849) & 65535` is
  bounded *whatever its input was*, so the mask makes the recursion
  irrelevant — which is precisely what made the gap look like a property of
  `Ball`. Found by nts-69 by instrumenting the lattice rather than by reading
  the emitted struct, which is what I did.

  The lesson is about my evidence, not theirs. Two lanes emitting `double`
  told me the narrowing had not happened; it could not tell me *why*, and I
  reported a cause at the granularity my instrument could see rather than at
  the granularity of the bug. "Fields are not narrowed" and "this field could
  not be narrowed" produce identical bytecode.

- **The `bounces` accumulator**, which is a `double` (`dadd`) where the loop
  counter beside it in the same loop is correctly an `int`. Possibly the same
  self-dependent-field bug if it is a field; a separate gap if it is a local.
  Open, and named rather than guessed at.

## The candidate list is now empty, and that is the result

0099 named three: slot reuse by live range, fusing block-parameter copies, and
the materialised boolean. All three have been tested and none is the residue.

**Bytecode volume** — record 0102. Constants stopped going to slots: 196 → 160
bytecodes on `generator`'s per-element body, and the time did not move at all.

**Redundant jumps.** Seven of fourteen `goto`s in `Ball$bounce` targeted the
next instruction, because the `Branch` lowering checked for fall-through on the
path without block-parameter copies and not on the path with them. Fixed in
`852b9ca`, and it measured **about 1%** — `awfy-bounce` 7.28us to 7.20us.
Predicted beforehand: a jump to the next instruction is the cheapest thing a
JIT removes.

**The materialised boolean.** Refuted by counting: `Ball$bounce` emits **four**
conditional branches and the hand-written reference emits **four**. There is no
extra test to remove.

## Where the numbers actually point now

    ours        7873.8 ns/op   57.51e9 instructions   11.65e9 branches   IPC 5.75
    reference   4774.6 ns/op   37.19e9 instructions    7.16e9 branches   IPC 6.02

1.55x the instructions, **1.63x the branches**, and *the same IPC*. Unlike
`generator` -- identical branches with 3.4x the cycles, which is latency --
this is throughput: the program executes more work at the same efficiency.

And the extra branches are **not in the hot method**, which has the same four.
So they are in the caller or in what the caller inlines, and the next
measurement is a branch profile per method rather than another guess at the
emitter. `Ball$bounce`'s prologue is 19 default stores and it runs 5,000 times
per operation rather than once -- the amortisation argument this record made
for `awfy-bounce` was about the *caller*, and it does not hold for the callee.

Four candidates tested, four refuted, and the residue is still unattributed.
That is worth writing down as a state rather than leaving the list looking
untried.

## The prologue costs nothing either, measured in the reference

Nineteen locals given a default at entry and then overwritten -- what this
backend emits for definite assignment -- added to the hand-written reference,
consumed at the end so javac cannot drop them:

    no prologue   4.57 us/op
    prologue      4.57 us/op

Identical. At 5,000 calls per operation. Predicted before measuring, for the
reason that made it worth testing anyway: this record had asserted the
prologue was amortised, and that assertion was wrong about *which* method --
`Ball$bounce` is the per-ball function, so its prologue runs per ball. It is
free regardless, but it was free for a different reason than the one written
down.

## Five refuted, and the shape of what is left

| candidate | verdict |
| --- | --- |
| bytecode volume | 196 → 160 bytecodes, zero change (0102) |
| redundant `goto`s | 7 of 14 removed, ~1% |
| the materialised boolean | 4 conditional branches ours, 4 theirs |
| the definite-assignment prologue | 4.57 against 4.57 |
| slot traffic | the prologue test is nineteen locals of it, and free |

`async-profiler`, both sides, same program:

    ours        Ball$bounce 1103ms (62%)   Bounce$benchmark 557ms (31%)
    reference   bounce       603ms (55%)   benchmark        315ms (29%)

**1.83x and 1.77x -- the same ratio in both methods.** There is no hotspot.
The program is uniformly slower at the same IPC with 1.55x the instructions,
which is not a defect with a location; it is the aggregate of an emission
strategy.

That is a different kind of answer from every other row settled today, each of
which had a single cause and a single fix. It means the next move for
`awfy-bounce` is not another peephole -- five have now been tried and priced --
but a measurement of *which machine instructions* the extra 1.55x are, from
`hsdis` on both sides rather than from the bytecode. Recorded as a state so
the next attempt starts from here rather than from the candidate list.

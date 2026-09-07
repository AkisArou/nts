# I removed the merge and saved one instruction

`awfy-queens` is the last AWFY row above hand-written Java, at 1.25x, and the
note beside the `jvm` floor names the cause: the materialised boolean. It has a
control behind it, which is why I believed it — materialising the same three
booleans in the *reference*, one method and the same checksum, moved that
benchmark from 8,946 ns to 12,019 ns, which is the whole gap.

    getRowColumn: return this.freeRows![r] && this.freeMaxs![c + r] && this.freeMins![c - r + 7];

70 instructions from this backend against javac's 25. Each `&&` becomes a merge
block whose parameter gets a slot, so every incoming edge writes it and the
merge reads it back. javac has no merge at all.

## The transformation, and what it actually bought

Threading a jump through an empty block that only branches on its own
parameter: each predecessor's `Jump(merge, [x])` becomes the merge's own
`Branch(x, …)`, with the parameter substituted in the successors' arguments.

**70 → 71.** Worse. On the `&&` shape the else arm carries the very value the
predecessor just branched on, so the threaded branch re-tests something already
decided.

So I added the edge fact — a block with a single predecessor that branched on
this value is reached only when that value took the matching answer — which
turns that arm into a plain jump.

**70 → 69.** One instruction.

And `examples/class-values` began answering `0` where node says `100`. A
miscompile, from a transformation whose entire yield was one instruction. It is
reverted.

## Where the instructions actually are

I had never counted them, which is the part worth writing down.

    12   the prologue: a default stored into each of six crossing slots
    ~10  three bounds calls: `dup, arraylength, invokestatic` per array access,
         where javac has the JVM's own check and an `int` index
     ~6  the two merges
     42  the work

The merges are **six instructions of seventy**. The diagnosis was not wrong
about the benchmark — the control is real and I have no reason to doubt it — but
it was wrong about the mechanism, and I read a claim about *time* as a claim
about *bytecode*. Materialising booleans in Java costs something at run time;
whatever that something is, it is not six instructions of code size, and
removing them was never going to move a 1.25x row.

The prologue is the largest single block, and it is not loose change either: it
exists because the stack map table here declares every slot's type at every
branch target, so every slot must be definitely assigned everywhere. Removing it
means per-block frames, which `body.rs` documents as the price and defers until
a histogram says a real function is near the slot limit. That trade has not
changed.

## What I take from it

**A control that reproduces an effect does not locate it.** The reference
experiment proved that materialising those booleans costs 3,000 ns. I read that
as "the merge instructions are the cost", which is a different claim and one
nothing had tested. The instrument that would have separated them — counting the
instructions — took two minutes and I ran it *after* building the optimisation
rather than before.

That is the same order-of-operations mistake the plan's own text warns about,
recorded there as two builds that targeted costs which did not exist. This is
the third, and the first where the cost was real but somewhere else.

**And an optimisation whose yield is one instruction is not worth a soundness
risk**, whatever the risk turns out to be. I did not find the miscompile's cause
and am not going to: the cost-benefit was already decided by the counting, and
debugging a change I would discard anyway is how the second hour gets spent.

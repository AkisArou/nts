# 0080 — Specialization is worth 8.5x on one row and −91% on the next

The JVM backend's `loop` row read 1.32us against 683.9ns for both native
backends — 1.93x, on the simplest kernel in the suite. This is what it turned
out to be, and it is not the backend.

## The measurement

`nts hir --prepared` shows the specializer splitting `accumulate` in two: a
whole-number fast path `accumulate#whole(n: i32)` with an `i32` counter, and the
original `f64` loop kept as a fallback for a non-integral argument. Both are in
the emitted class, which makes the comparison an A/B *within one generated
program* rather than between two.

    my generated code, specialised int path  (n=1000)     1324.5 ns
    my generated code, unspecialised double  (n=1000.5)    693.4 ns
    hand-written Java                        (n=1000)      684.0 ns

**The unspecialised path is within 1.4% of hand-written Java.** The whole of the
1.93x is the specialization, and none of it is the emitter.

The loop is real, not folded: time scales 1.00 / 2.03 / 4.09 / 8.21 across
n = 1000 / 2000 / 4000 / 8000. At 684ns for a thousand iterations it is sitting
exactly on the dependent double-add latency, which is the floor for this kernel
and which all four lanes reach.

## Why it costs on this row and pays on the next

`checksum` is the contrast, and it is the same compiler making the same choice:

    row        nts C     nts JVM   nts f64   what the arithmetic is
    checksum   4.79us    5.05us    22.83us   integer: *, ^, <<, >>>
    loop       683.9ns   1324.5ns  703.0ns   float: i*i and i/2 are doubles

On `checksum` the values are integers *and so are the operations*, so proving
the counter integral replaces `dmul` with `imul` and is worth **8.5x** — on the
JVM as much as anywhere.

On `loop` the values are integral and the operations are not. `i * i` and
`i / 2` are double arithmetic whatever `i` is stored as, so an `i32` counter
buys no cheaper instruction and costs an `i2d` at every use. The published
`nts f64` column already says specialization is worth about 1% here for the C
backend — 683.9 against 703.0. What is new is that the same choice is worth
**−91%** for this one.

## The general shape, and a correction to the first version of it

The first draft of this record concluded that `specialize_numbers` is a property
of the program **and the backend**. That is true and it is not the useful
statement, and the sharper one came from the session that owns the pass.

The question is not "which backend". It is **"do the operations reaching this
value do integer arithmetic?"** — and that is backend-independent. Where the
answer is no, narrowing the counter buys no cheaper instruction on *any* lane
and generates a conversion at every use. C absorbs the conversions and the JVM
does not, so only one lane pays; but the decision was already wrong for both.

That distinction matters for where the fix belongs. "Ask the backend" would put
a target property into a middle-end pass. "Ask whether anything does integer
arithmetic with this" is a fact about the program that `hir::flow` and
`hir::facts` are already most of the way to answering — they prove integrality
and carry the interval, and what is missing is the use side.

What the two backends made unfalsifiable is worth stating too: with both
consumers erasing the difference, the decision was free when right and free when
wrong, so nothing in the compiler could distinguish a good one from a bad one.
A third consumer did not create the problem. It made the problem measurable.

This is the second finding of the same shape in a day. The first was that every
SSA value round-tripping through a local costs nothing in C because mem2reg
removes it, and 28 of 39 instructions on the JVM. Both are the shared middle end
being right about the work and wrong about who has to do it.

## The mechanism: it is latency, not work

`perf stat` over the two paths, same harness, same class file:

    path                     cycles    instructions      IPC
    specialised int         2.858 G         2.627 G     0.92
    unspecialised double    2.312 G         5.708 G     2.47

**The double path executes 2.17x more instructions in fewer cycles.** That is
the whole answer in one line: the specialised path is not doing more work, it is
stalling. An IPC of 0.92 on a kernel with no memory traffic and a 0.02%
branch-miss rate is a dependency chain, not a throughput limit.

So the `i2d` conversions are not free instructions sitting beside the
computation — they are *on* the critical path, feeding the `dmul` that feeds the
accumulation. Removing the counter's narrowing removes them from the chain.

This matters for whether the row is winnable. If the cost were extra
instructions, a better emitter or a better C2 could absorb them. Latency on a
loop-carried chain cannot be absorbed by anything downstream: the only fix is
not to create the conversion, which is a decision made several passes earlier.

Still unmeasured, and worth knowing before the pass changes: whether C2's
counted-loop recognition also changes between the two shapes.
`-XX:+PrintAssembly` needs `hsdis`, which is not installed.

## What follows

Not "turn specialization off". `checksum` says that would cost 8.5x on the rows
where it pays, which is most of them.

What follows is that the decision needs a term the compiler does not currently
have: whether the operations reaching the specialized value are integer
operations. Where they are, specialize. Where the value is only ever an operand
to float arithmetic, an `i32` counter is a conversion generator. `hir::flow`
already proves integrality and `hir::facts` already carries the interval; what
is missing is the use-side question, and it is worth asking for both backends
even though only one of them currently pays for the wrong answer.

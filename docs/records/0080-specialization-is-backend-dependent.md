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

## The general shape, which is the reason for the record

A middle-end optimization is usually backend-independent: it either removes work
or it does not. This one is not. It replaces one representation with another,
and whether that is a win depends on what the *backend's* machine does with the
conversions at the boundary — and clang makes them free here while C2 does not.

So `specialize_numbers` is not a property of the program. It is a property of
the program **and the backend**, and the compiler currently models it as the
first. That is invisible with two backends whose optimizer erases the
difference, and it became visible the moment a third arrived without one.

This is the second finding of the same shape in a day. The first was that every
SSA value round-tripping through a local costs nothing in C because mem2reg
removes it, and 28 of 39 instructions on the JVM. Both are the shared middle end
being right about the work and wrong about who has to do it.

## What this does not yet say

*Why* C2 does not absorb the conversion is unmeasured. The candidates are the
`i2d` landing on the dependency chain, the counted-loop recognition changing, or
C2 declining an optimization it applies to the `f64` shape. Answering it needs
`-XX:+PrintAssembly` with `hsdis`, which is not installed. **The decision below
does not depend on the answer**, but the answer decides whether this is a row
this backend can win back or one it has to route around.

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

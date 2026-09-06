# Six conversions deleted, and the time did not move

`awfy-queens` is 1.35x C++ on both backends, and the emitted C had an obvious
reason:

    static bool Queens__placeQueen__whole(NtsObj_Queens *, int64_t) {
      v25 = (double)v3;  v26 = (double)v1;
      v8 = Queens__getRowColumn(v0, v25, v26);      <- (double, double)

Seven `(double)` conversions in the specialized body, six of them purely to
reach two helpers whose board index runs 0 to 7. The JVM session found it on
their lane first and priced it at 1.32x instructions; it reproduces here exactly.

**It is now measured, and it is worth nothing.**

## The cause, which was real

`guards::install` clones a root and puts a whole-number test in front of it, so
the copy's parameters are provably integers and `signatures::specialize` can
narrow them. It clones **one function**. The copy then calls the same helpers
the general body calls — so each helper's interprocedural join has one proven
caller and one unproven one, and `signatures` narrows it by the rule it narrows
everything by: not at all.

The fix is small and needs no new analysis. Clone what the narrow path *calls*,
so each copy's only callers are inside the path, and let the ordinary rule do
the rest. Sixty lines, a budget, and a retraction for a copy whose signature
turned out not to move.

It worked exactly as designed:

    static bool Queens__getRowColumn__whole(NtsObj_Queens *, int32_t, int64_t)
    static void Queens__setRowColumn__whole(NtsObj_Queens *, int32_t, int64_t, bool)

    conversions in placeQueen__whole:  7 -> 1

and the narrowed helper's body is pure integer arithmetic with no double
anywhere in it. All 112 examples still agree with node.

## The measurement

Three runs each, on a quiet machine, under the lock, cores 8-15, before and
after:

    awfy-queens     nts C           nts LLVM        C++
    before          6.60 6.58 6.56  6.52 6.55 6.52  4.82 4.80 4.81
    after           6.62 6.60 6.61  6.58 6.58 6.56  4.79 4.80 4.80

    awfy-permute    nts C           nts LLVM
    before          10.64 10.64 10.61   10.66 10.63 10.64
    after           10.61 10.60 10.62   10.64 10.63 10.64

Noise is half a percent and the readings are stable to it. **Nothing moved**, and
the LLVM lane is consistently about one percent slower after — six hundredths of
a microsecond, three times, in the same direction.

Reverted.

## Why, and it is the part worth keeping

An HIR conversion is not a machine conversion. Compiling the two emitted C files
with the same flags and counting inside the hot function alone:

    Queens__placeQueen__whole      lines   cvtsi2sd   calls
    before                            90          2       4
    after                            182          7       7

The function that has **six fewer conversions in the IR** has *five more* in the
compiled code and is twice the size. The helpers were external before, so clang
emitted calls; the copies are static, so it inlined them, and what it inlined it
then had to reconcile with its own view of the arithmetic.

Which is the whole finding: **clang was already doing this, and doing it with
more information than the pass has.** The pass deleted conversions the C compiler
would have deleted anyway, and the copies it made to do it changed the inlining
decisions underneath.

## Two predictions, both wrong, and that is the value

I said before measuring that it would come in "at less than the 1.32x gap
suggests — a few percent". The JVM session bet ten to fifteen, on the sharper
reasoning that a `double` board index also buys a double bounds check and an
index the callee cannot keep in a register — which is a better argument than
mine and predicts a bigger number than mine.

Zero. Both of us reasoned from the IR about a cost the backend pays, and the
backend had already stopped paying it.

**The proxy pointed the opposite way to the measurement.** Counting `(double)`
casts in emitted C is the most natural instrument for this question and it is
the one the standing rule warns about in those words: *proxies lie — change the
runtime or the IR.* I did change the IR. The proxy went 7 to 1 and the machine
went 2 to 7.

## What this says about the 1.35x

It is not the boundary conversions, and that is now a fact rather than a
hypothesis — which is worth more than the change would have been, because it was
the leading explanation on two lanes at once. `awfy-queens` is still 1.35x C++
and the reason is still unknown.

The JVM session's 1.32x **instruction** gap is a different measurement on a
different backend and this says nothing about it. C2 inlines by its own rules and
their bytecode is what a HIR change would improve. The patch is saved and they
have it; if it pays there it lands with their number on it, and one lane's zero
is not evidence about another's.

## Ratchets

- **None, and that is the outcome.** The change is reverted, so there is nothing
  to ratchet. What is kept is the measurement and the two wrong predictions.
- No example, no test, no memory case: a reverted change ships none of the four,
  and a fixture for a pass that does not exist is a fixture for nothing.
- `benches/cases/awfy-queens` and `awfy-permute` already exist and are what
  measured it. Their numbers are unchanged and now have a hypothesis ruled out
  behind them.

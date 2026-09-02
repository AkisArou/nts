# 0030 — Numbers were already there

The queue says `number (confirm)`, and the rule is that a primitive already at
its floor is closed by one measurement rather than assumed. This is that
measurement, and it says two things: the primitive is done, and the goal's
expectation of where its gap would be was written against a comment that had
stopped being true.

## The measurement

Against the C++ ceiling, on the rows whose work is arithmetic:

    loop              0.99x        checksum        1.00x
    awfy-mandelbrot   0.99x        accumulate      0.99x
    awfy-sieve        0.97x

There is no room left in those. Three of them are *under* one, which is what a
hand-written C++ reference losing to a compiler looks like when the compiler
proves something the programmer did not bother to.

Four rows sit above it and none of them is a number row:

    fib               1.70x    recursive calls
    awfy-queens       1.40x    an array of positions per level
    awfy-permute      1.34x    an array, permuted in place
    awfy-nbody        1.13x    an array of bodies

Calls and arrays, which are two later items in the same queue. Charging them to
`number` would be the mistake this ordering exists to avoid.

## What the analysis is worth

`nts f64` is the same compiler with number specialization off, and it prices the
thing rather than assuming it:

    accumulate   1.08us -> 18.76us    seventeen times
    checksum     4.78us -> 40.95us    nine times

So the facts are being proved and they are load-bearing. `loop` barely moves,
which is the honest other half: a loop whose body is one add has nothing for the
representation to save.

## The gap the goal named does not exist

The goal said "expect the only gap to be the int64 column". There is no int64
column. `tooling/bench` used to carry two C references -- `C (double)` and
`C (int64)` -- and merged them, deliberately, with a comment saying why: the
double one was really answering "what does the conservative lowering cost", and
`nts f64` answers that better because it measures the compiler's output rather
than a hand-written simulation of it.

The module header eighty lines above still described all three, and still said
"Reaching C (int64) means the *compiler* is done". That sentence is where the
goal's expectation came from -- I wrote it into the goal myself, from the old
goal, which took it from the header. It now describes the columns that exist.

That is the second time this week a stale comment has reached a goal: `escape`'s
header claimed a blind spot that had been fixed three hundred lines below it,
and `0028` records what that cost. A comment is what the next reader plans from,
and neither of these was wrong when it was written.

## Verdict

`number` is closed. Correctness: every case in the differential, which is the
whole suite. Memory: nothing to measure -- a double is not an allocation, and
the memory suite's floors are zero wherever numbers are all a case has. Speed:
0.97x to 1.00x against the ceiling on every row whose work is arithmetic.

What is left in the rows above one belongs to `function and closure` and to
`array`, and is not this primitive's to answer.

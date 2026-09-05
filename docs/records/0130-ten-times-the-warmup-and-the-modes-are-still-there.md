# 0130 — Ten times the warmup and the modes are still there

**Status: hypothesis, tested, refuted.**

`dispatch` publishes 0.70x or 1.10x depending on the run. `Bench` warms up for
20,000 iterations bounded by 300 ms, and that case runs at ~29 us/op -- so the
time bound binds first and the method is invoked about **ten thousand** times
before measurement, which is where C2 compiles. A plausible story: sometimes the
good shape exists when the timing starts and sometimes it does not.

Ten times the budget, six runs each, same binary, under the lock:

    300 ms warmup   28.63  34.70  28.40  34.20  18.34  28.24
    3 s   warmup    33.86  33.26  33.25  33.15  18.01  27.88

**Same spread, about 1.9x either way.** Whatever picks between the modes is not
settled by running longer, and the fast one at ~18 us appears once in six in
both columns.

Worth noting the 3-second column is *tighter* in its slow mode -- four runs
within 0.7% -- which is what more warmup should do, and then still produces an
18.01. So the extra warmup did exactly what it should and the bimodality is
orthogonal to it.

## What was kept

`RUNS` went from 3 to 5, which its own comment had already measured: *"a
best-of-five inside one process is not enough for a JIT. Measured over five
processes..."* above a constant that said three. That is not a fix, it is odds
-- the fast shape turns up about half the time rather than one set in five.

And `measure` now carries its slowest pass over its fastest, with a note when a
row exceeds 1.25x. Its limit is stated where it is defined: it catches a set
that spans both modes, not one that lands wholly in one, and `dispatch`
published 1.08x with no note on the run after it landed.

## Why this matters more than the row

Three rows move further than the changes being judged against them --
`dispatch`, `array-predicates` (1.25x through 1.76x today) and `awfy-bounce`
(4.37 and 4.74 us with byte-identical output). Every effect measured today is
smaller than `dispatch`'s spread.

A column cannot certify a row it cannot pin, and the honest form of that is not
"the number is 1.08x" but "this row has two answers and the published one is
whichever the JIT found". `checksum` reported 1.00x nine times out of nine in
the same window, so this is a property of particular programs and not of the
machine or the harness.

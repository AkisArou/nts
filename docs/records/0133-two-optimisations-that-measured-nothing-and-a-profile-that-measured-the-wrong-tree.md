# 0133 — Two optimisations that measured nothing, and a profile that measured the wrong tree

Three negative results from one afternoon, kept because the reasons are worth
more than the changes would have been.

## The store/load peephole, not built

Record 0099 measured `awfy-bounce` at 1.53x the reference's instructions and
named the store/load round trip. The obvious backend answer is a peephole:
`store N; load N` adjacent on one slot, delete both.

Counted before writing it:

    awfy-bounce   499 instructions,  10 adjacent store-then-load  (4.0%)
    loop          144 instructions,   3                           (4.2%)
    checksum      177 instructions,   3                           (3.4%)
    dispatch      715 instructions,   3                           (0.8%)

**`checksum` has the same rate as `awfy-bounce` and sits at 1.00x**, and
`dispatch` -- the worst row of the four -- has the least. The peephole cannot be
what separates them. Whatever 0099's 1.53x is, it is not the adjacent round
trip, and a peephole would have been a day spent to measure nothing.

## The literal divisor, built and reverted

`idiv` and `irem` throw on a zero divisor, so every integer division in this
backend goes through a runtime helper that raises the refusal instead. The
comment beside it says *"nothing upstream proves the divisor non-zero"* -- true
of the general case, and not true when the divisor is written in the program.
Five lines make `i % 3` a bare `irem`.

Instrumented rather than assumed, across 116 examples and every bench case:

    literal-divisor arm fired 2 times

Both in `examples/control`, in `assignedInALoop` and `assignedInASwitch`, and
neither is a hot loop in any measured row.

**The reason it fires twice is worth more than the change.** A TypeScript
`number` is an `f64`, so `%` lowers to `drem` and integer division barely exists
in this backend's output at all:

    %1 = const 3 : f64
    %2 = rem %0, %1 : f64

That is `benches/cases/instanceof`, whose whole subject is `i % 3`. The integer
helper it never calls was the thing I set out to remove.

## And the profile that sent me there was measuring a tree being rewritten

I read `NtsRuntime.irem` at **16.3% of `absences` and 16.5% of `instanceof`**
and went straight at it. Both rows compute `i % 3` and the story wrote itself.

The full-table run was publishing at the time, and it regenerates
`target/bench/*.jvm` and the runtime jar -- the exact directories I was
profiling. A second profile of `absences`, taken after, has no `irem` in it at
all.

So the number was real in the sense that a JVM produced it, and meaningless in
the sense that it described a classpath being overwritten underneath the
process. **A profile of a directory something else is writing is not a
measurement**, and the whole six-row batch taken in that window went in the bin
with it.

That is the second time today the tree moving under a measurement produced a
finding that was not there -- record 0132 has the first, where five numbers from
five trees looked like instrument noise. The rule that covers both: pin the
inputs, not just the machine. The lock stops another process competing for the
CPU and does nothing at all about one editing the files.

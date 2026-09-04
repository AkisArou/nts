# 0088 — The cliff is 4.0x on the native lane and 1.4% on the JVM

`hir::arrays_can_grow` is a **whole-program** predicate: one `push` anywhere puts
every array in the program behind a wrapper, because an array that grows cannot
keep its elements inline after its own header without moving. `benches/cases`
has a pair built to price exactly that — `growth-fixed` and `growth-grown`,
character-for-character identical below setup, differing in one call.

The JVM backend has refused every growing program since it was written, on the
plan's reasoning that the wrapper is a real cost and should be measured before
it is built. This is that measurement, taken **before** writing any of it.

## The numbers

Two hand-written Java programs, transcribed from `growth-fixed/src/main.ts`
below setup, run under `benches/common/Bench.java` on a quiet machine holding
the measurement lock:

    bare double[]   174,968.76 ns      174,278.70 ns
    wrapper         177,179.30 ns      176,833.96 ns

**1.014x.** Identical checksums. Two runs each, and the spread within a
representation is larger than the gap between them on one of the pairs.

The same pair on the native lane, from the README table:

    growth-fixed    nts C  163.03 us
    growth-grown    nts C  655.17 us

**4.02x.**

## Why the platforms disagree by a factor of three hundred

Not because the JVM is faster. Because the two costs are different costs.

On the native lane the wrapper is a pointer to elements held elsewhere, so every
read is a load of the pointer and then a load through it — a dependent pair the
hardware cannot start until the first completes — and the compiler must assume
the pointer can change whenever anything writes.

On the JVM **the bare array was already that shape**. A `double[]` is a heap
object with a header, and `xs[i]` is already a load of the reference from a
local, a bounds check against a field, and a load through it. The wrapper adds
one more field load, which C2 hoists out of the loop because the field is not
written inside it, and a bounds check that was mandatory anyway.

So the honest statement is not "the JVM handles growth better". It is that
**the JVM was already paying the price the native lane pays only when it has
to**, and the cliff the C lane falls off is ground the JVM has been standing on
the whole time.

## What it decides

Build the wrapper. The refusal was worth having until this number existed and is
not worth having now: `arrays_can_grow` is true in 20 of 23 `runtime/node`
modules and false in 2 of 93 examples, so the wrapper is what real code gets and
the bare array is what a benchmark gets. A 1.4% cost on the shape that real code
takes is not a cost worth a refusal.

It also removes an argument for pushing per-array analysis upstream *for this
lane*. `hir::escape` and `hir::elements` already work per-array and the C lane
would gain 4x from using them; the JVM would gain 1.4%, so the two backends
should not expect to want the same thing here, which is record 0080's point
arriving in a second place.

## What this does not measure

`push` itself. Both programs above build the array the same way — the wrapper's
`push` is in the setup loop, not the kernel — because the pair exists to price
the *representation the hot loop reads*, which is what the whole-program
predicate changes. Growth amortisation is a separate question and this says
nothing about it.

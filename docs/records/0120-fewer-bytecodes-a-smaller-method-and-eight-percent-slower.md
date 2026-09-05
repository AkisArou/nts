# 0120 — Fewer bytecodes, a smaller method, and eight percent slower

**Status: built, measured, reverted.** The reason is the record.

The first item on the standing list has been there for weeks: *the emitter
stores every SSA value to a slot and reloads it. The JVM is a stack machine;
HIR knows which values have one use in the next operation and never need a
slot.* Every word of that is true and the conclusion does not follow.

A value with one use, consumed by the very next operation as the first thing
that operation pushes, was left on the operand stack instead of round-tripping
through a local.

    checksum      177 -> 149 instructions,  112 -> 84 slot traffic
    awfy-bounce   572 -> 532,               330 -> 290
    generator     287 -> 269,               161 -> 143
    fib           100 ->  90,                53 -> 43

    Ball$bounce   261 -> 245 bytes

And then:

    awfy-bounce   4.37 us -> 4.77 us     0.96x -> 1.04x

Twice, against two prior runs that agreed to 0.01 us. Nothing else moved:
`checksum` 1.00x, `objects` 1.03x, `fib` 1.04x, `awfy-nbody` 1.08x, `generator`
3.41x, all unchanged.

**Fewer instructions, a smaller method, and eight percent slower on the one row
that noticed.**

## Why this is not record 0102 again

0102 measured a bytecode reduction at *zero* and concluded volume is not the
currency. 0111 qualified that: volume is free until it crosses an inlining
threshold. Both would have predicted **no change** here, and the honest
statement is that neither predicted a *loss*.

`Ball$bounce` went 261 to 245 bytes, so it was under `FreqInlineSize` before and
after and no threshold moved. Whatever this cost, it was not inlining. The
mechanism is unattributed -- most likely C2's parser rebuilding SSA from a
deeper expression tree and allocating registers differently -- and attributing
it would cost more than the change is worth, because the change is worth
nothing even if the loss were noise.

## What it did buy, and it is not performance

The premise was wrong the first time and `logical-assignment` said so: 52 cases
disagreed and `throughAnElement` returned -6 for every input. **A truthiness
test on a scalar loads its operand three times for one HIR use** -- a NaN
self-compare and then a compare against zero. `uses` counts operand occurrences
in the IR; the emitter loads as often as it likes.

That is worth keeping even though the code is not:

> One use in the IR is not one load in the output, and no analysis over HIR can
> know how many times this emitter reads a value without duplicating the
> emitter.

It is the same shape as `hir::operands_of` existing at all -- *"two
implementations of what does this operation read would eventually disagree"* --
one level lower down, and it is an argument against the whole family of
peepholes that reason about use counts from the IR side.

The emitter also refused the first attempt outright rather than miscompiling it,
because it checks its own stack accounting after every operation. That check
earned its comment twice now.

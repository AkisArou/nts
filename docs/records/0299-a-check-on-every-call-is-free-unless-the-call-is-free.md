# A check on every call is free unless the call is free

Unbounded recursion is `SIGSEGV` here where node throws a `RangeError`. The
queue's instruction was to **price a depth check before building one**, on the
premise that a check on every call is the kind of cost this project exists not to
pay.

The premise is true for one shape of program and false for every other.

## The measurement

Three arms over the emitted `fib__whole` from `benches/cases/fib`, copied
verbatim so the arms differ in the check and nothing else. `fib` is nearly pure
call overhead, which makes it the worst case rather than a representative one.
Minimum of ten runs each, each run a best-of-five:

    body does nothing        none 2.08    counter 4.08 (1.96x)   stack-ptr 2.77 (1.33x)
    eight flops per call     none 15.25   counter 15.27 (1.00x)  stack-ptr 15.27 (1.00x)
    thirty-two flops         none 53.13   counter 53.13 (1.00x)  stack-ptr 53.13 (1.00x)

**Eight floating-point operations in the body is enough to make the check
disappear.** Not shrink — disappear, to within 0.13%.

## The check is still there

That number invites exactly one suspicion, so it was checked rather than
believed. In the assembly at eight flops per call:

    arm 0 (no check)      40 instructions,  0 referencing the check's global
    arm 1 (counter)       57 instructions,  5 referencing `nts_depth`
    arm 2 (stack pointer) 57 instructions,  1 referencing `nts_stack_floor`

Seventeen extra instructions, present, not hoisted, and costing nothing
measurable. The check has no data dependency on the arithmetic, so a superscalar
core issues it alongside work it does not have to wait for. It is only visible
when there is no other work to hide behind.

## Which form

The stack-pointer compare, not the counter, and the assembly says why: **one
global reference against five, and no memory write.** A counter increments on
entry and decrements on exit, which is two stores per call and a value that has
to survive the callee; a pointer compare reads a global and compares it against
the address of a local, and writes nothing.

The 1.96x against 1.33x at zero work is that difference, and it is the only
regime where either is visible at all.

## What this settles

Building it is affordable. The row stays ✗ because nothing is built, but it no
longer waits on the question it was waiting on — and the next person does not
have to re-derive that the worst case is the *only* case.

The general form is worth more than the row. **A per-call cost is measured
against what the call already does, and a benchmark of pure call overhead
measures the check against nothing.** `fib` is the right instrument for finding
the ceiling and the wrong one for deciding affordability, and quoting only its
number would have argued against a feature that costs nothing in every program
anybody writes.

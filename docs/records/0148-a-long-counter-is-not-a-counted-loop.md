# 0148 — A `long` counter is not a counted loop

`elementwise` was 7.61x hand-written Java. It is the cleanest codegen row in the
suite: a bare `double[]`, 512 passes over 4096 elements, `xs[i] = xs[i] * k`, no
wrapper, no growth, no erasure, nothing between us and the loop. The whole 7.61x
is the type of the loop counter.

## The measurement, before the change

The same loop written twice in Java over the same `double[]`, differing only in
the counter. Instructions per call, fixed-count driver at 200 and 400 calls,
subtracted, three repetitions, medians:

| | instructions/call | per element |
| --- | ---: | ---: |
| `int i`, `xs[i]` | 1,414,434 | **0.67** |
| `long i`, `xs[(int) i]` | 18,513,608 | **8.8** |

**13.1x.** Two million element updates a call at 0.67 instructions each is a
vectorised loop: C2 eliminated the range check, unrolled, and moved four doubles
at a time. At 8.8 it did none of that. A `long` induction variable is not a
counted loop to C2 under any circumstances, and every array walk this compiler
emitted was one, because `array.len` is typed `i64` and the counter that compares
against it is typed to match.

This is what `elementwise`'s own comment predicted three months ago in the LLVM
vocabulary -- *"a counter bounded by it is not provably an `int32`, and one left
as a `double` makes every index an `fptoui` of a floating-point induction
variable, which LLVM's scalar evolution cannot model"*. Same failure, one type
up, and nobody had priced it on this lane.

## After

    81: aload_0            //   the header, in full
    82: arraylength
    83: istore 13
    85: iload  12
    87: iload  13
    89: if_icmpge 131
    92: aload_0
    93: iload  12
    95: daload

No `lload`, no `lcmp`, no `l2i`, no `ladd` anywhere in the class.

| | instructions/call |
| --- | ---: |
| hand-written Java, `int` counter | 1,414,434 |
| **ours** | **1,405,350** |

**0.994x in instructions.** Same checksum, verifies under `-Xverify:all`.

Timed, under the lock, JVM lane only -- and instructions and nanoseconds are
different units, so this is a second measurement rather than the same one
restated:

| row | before | after |
| --- | ---: | ---: |
| `elementwise` | 7.61x | **1.04x** |
| `array-predicates` | 4.28x | **3.28x** |
| `awfy-nbody` | 1.08x | **1.00x** |
| `pipeline` | 1.01x | **1.00x** |
| `fib` | 1.04x | 1.03x |
| `arrays` | 1.35x | 1.35x |
| `array-from` | 2.39x | 2.39x |

`arrays` does not move and that is the right control: its loop bound is a
32-element literal, so its counter was already an `i32` and there was nothing
here to narrow. Its 1.35x is the element *width* -- `dmul` against `imul` down a
dependency chain -- which is a different fact and is the reference's to fix.
`array-from` does not move because its 2,000-round loop is bounded by a
constant too; what is left there is `Arrays.copyOf` of 256 elements.

The gap between 0.994x in instructions and 1.04x in time on `elementwise` is
real and unattributed. It is 4% and I have not spent a measurement on it.

## Why this is the backend's to decide, and only until it is not

`array.len` is `i64` in HIR. On this lane it is `arraylength`, which **is** an
`int`, so a value derived from one is provably in `[0, 2^31)` whatever the IR
says. The IR is untouched, every lane still gets the same program, and what
differs is how this backend realises an `i64` -- the latitude `widen` already
takes with an `i32`.

nts-69 has taken the upstream half and chosen `Int{32, signed}`, with a third
answer better than either I offered: move `nts_array_allocate`'s refusal from
2^32−1 to the int32 bound, so the type is a consequence of a documented refusal
rather than a claim about an array no lane can allocate. When that lands every
value here arrives `i32` already, this pass finds nothing, and **it should be
deleted rather than kept as a fallback.**

## Four ways to be wrong, and the instrument that caught all four

None of these reached a class file. The emitter's own stack accounting refused
each one by name, which is worth recording because the design of that check is
what made a representation change survivable at all.

1. **A narrowed `array.len` adapted to its declaration.** The `Length` arm
   emitted `arraylength; i2l` for an `int` slot. *"emitting %11 moved the operand
   stack from 0 to 1."* Fixed by adapting to what the value is *held* in rather
   than what it declares -- `adapt_to` beside `adapt`.
2. **`mul` of an unnarrowed counter by a narrowed constant.** The check that no
   arithmetic straddles the two representations compared *all operands chosen*
   against *the result chosen*, so **none chosen** and **result not chosen** read
   as agreement. Each operand has to be compared against the result, not the
   conjunction.
3. **`convert %66 : f64` over a narrowed operand.** `convert` is written in
   declared types, so `l2d` met an `int`. The operand is now put back in its
   declaration first.
4. **`field.set %0.0 = %5` with a narrowed `0` into a `J` field.** One word where
   two were wanted.

The fourth is the one that changed the design. Three fixes were at consumers,
and there are sixty-five sites that load a value and hand it to an instruction;
fixing them one at a time as the corpus finds them is not a method. So the pass
now **declines to narrow a value any operation reads by its declared type** --
a `putfield`, a `return`, a call argument -- with the default being unsafe, so an
operation added later costs a missed narrowing and never a wrong answer.

It costs something real: `array-predicates` keeps two `lcmp` and `awfy-sieve` two
`l2i`, in loops whose counter also reaches a call. That is the right way to lose.

## What the sweep is, and why it is not the gate

Six minutes of a shared machine answers *did anything stop agreeing with node*.
The question a codegen change can make worse on its own is narrower -- *did
anything stop being emitted* -- and that is 109 examples and 50 bench cases run
eight at a time, in well under a minute. It found the fourth bug, and it now
reports exactly three declines: `dates`, which is a type this lane has no
representation for yet, and the two standing symbol refusals.

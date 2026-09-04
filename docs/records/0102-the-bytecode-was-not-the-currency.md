# 0102 — The bytecode was not the currency

**18% fewer bytecodes, and the time did not move at all.** Predicted before
measuring, which is the only reason this is a result rather than a
disappointment.

## What was built

Constants were going to a local: `iconst_1; istore 40; iload 39; iload 40;
iadd` where `iload 39; iconst_1; iadd` is the same program. The JVM is a stack
machine and a constant is one instruction that cannot fail, so a constant now
emits nothing at its definition and is pushed at each use instead. A 128-bit
literal is excluded, because it is not a push — it is `NtsBigInt.of(J J)`,
which allocates.

`upTo__resume`, the per-element body of `benches/cases/generator`:

| | bytecodes | slot traffic | prologue |
| --- | ---: | ---: | ---: |
| before | 196 | 102 | 21 |
| after | 160 | 73 | 13 |
| hand-written Java | 29 | 0 | 0 |

## What it bought

| case | before | after | vs Java |
| --- | ---: | ---: | ---: |
| generator | 588.84 us | 588.88 us | 3.41x, unchanged |
| awfy-bounce | 7.29 us | 7.28 us | 1.60x, unchanged |
| awfy-nbody | 8.62 ms | 8.62 ms | 1.08x, unchanged |
| awfy-queens | 11.02 us | 10.96 us | 1.24x, noise |

Nothing. C2 folds a constant into a register before it has finished parsing,
and removing the store and the reload removed work that was already free.

## Why this is worth a record

It refutes the theory the whole queue was resting on. Record 0099 measured
**2.9x javac's bytecode on `awfy-bounce`, of which C2 recovers about half**,
and left the residue unattributed — and the obvious reading, which I held, was
that the residue *is* the slot traffic and that emitting less of it would
recover the rest.

It is not, and it would not. Three candidates were queued on that theory and
should not be built on it:

- **slot reuse by live range**, which costs the eighty-line StackMapTable
  design — frames become per-block again;
- **coalescing block parameters with their arguments**, so a loop counter's
  `iload 41; istore 16` vanishes;
- **eliminating the definite-assignment prologue**, which needs frames that
  declare unassigned slots as `top`.

Each is a real optimisation of a real inefficiency. None of them is a
measurement of anything that costs time, and the one experiment that could
distinguish "this is wasteful" from "this is expensive" had never been run.

## The rule this leaves

**A count is not a cost.** Bytecode volume is visible, easy to reduce, and
correlates with nothing here: the interpreter charges for every instruction
and C2 charges for almost none of them, so a static count measures the
interpreter. `-Xint` ratios say how much bytecode there is; only a timed run
says whether any of it is paid for.

The change stays. It is correct, the gate is 99 of 99, and 36 fewer
instructions and 8 fewer slots per method is real headroom against the 65,535
limit even when it is worth no time at all. But it was kept for a different
reason than it was built for, and that is the part worth writing down.

## What is next, and what would settle it

The 3.41x on `generator` is real and unexplained. Static reading has run out —
the bytecode has been counted, the histogram taken, and the largest visible
inefficiency has now been removed with no effect. The next instrument is
`async-profiler` on the case, with `event=alloc` as well as `event=cpu`,
because a per-element frame that is not scalar-replaced would be invisible to
every count taken so far.

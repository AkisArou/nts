# 0161 — The JVM driver never ran the top-level code

`symbol-keyed-map` computed **32768** where node computes **10240**, and the
benchmark harness caught it on the first run where the two could differ.

    symbol-keyed-map failed: nts (jvm) computed 40e0000000000000
    but node computed 40c4000000000000 -- the benchmark is measuring
    two different programs

The message is exactly right and it is about the harness rather than the
backend.

## What it was

`tooling/bench` generates a driver per lane. The native one has declared and
called `module__init` since the day that defect was found:

    void module__init(void);
    static int ready;
    if (!ready) { ready = 1; module__init(); }

The JVM one never did. `Case.java` called `nts.gen.Program.work(in0)` and
nothing else, and `nts/gen/Program.module$init()` sat in the class with **zero
callers**.

So every JVM benchmark of a case with module-level state has been measuring a
program whose globals are null. For almost all of them that is a different
program which happens to compute the same answer, which is why it stood: the
cross-lane checksum only fires when the difference reaches the result.

`symbol-keyed-map` is where it reached the result. Five module-level
`Symbol()` bindings, all null; `NtsValue.ofObject(null)` five times; every key
comparing equal by reference; the map holding one entry; and both lookups per
iteration returning the last value written. 4096 x 8 against 4096 x 2.5.

## The fix, and why it is not the native one's shape

A static initialiser:

    static { nts.gen.Program.module$init(); }

Class initialisation runs once, before `main`, and **outside the measured
region entirely** — where the native lane's `if (!ready)` sits inside the timed
function and pays a load and a branch per call. Emitted only when the program
has a `MODULE_INIT`, from `program.funcs` rather than by matching text.

## What it changes, measured

| row | before | after |
| --- | ---: | ---: |
| `symbol-keyed-map` | `refused`, then a wrong answer | **3.35x** |
| `closures` | 0.85x | 0.85x |
| `dispatch` | 1.03x | 1.03x |
| `generic-classes` | 1.12x | 1.12x |
| `module-closures` | 1.06x | 1.06x |

Nothing else moved, which is the answer to *how many rows were wrong*: the other
cases have no module-level state whose absence changes what the program does.
One row was affected and it is the row that exposed it.

`symbol-keyed-map` is now a real number and a new red row: **3.35x**, 25.17 us
against the reference's 7.51. It has been invisible twice — first as `refused`,
because a symbol had no representation on this lane until an hour ago, and then
as a wrong answer for the length of one publish.

## Why this one is worth a record rather than a line

Three sessions of this project have now found the same shape: two artifacts that
must agree, in different places, with nothing comparing them. A conformance row
against a fixture. A prediction against the arithmetic that refutes it. And
here, **two drivers for the same benchmark, written apart, where one learned
something the other did not.**

The native driver's comment says why it calls `module__init`. That comment is
five feet from the JVM driver's generation and neither file references the
other. The thing that caught it was not a review and not a test: it was the
harness's own rule that every variant of a case must produce the same checksum,
which is the one place in this tooling where two implementations are made to
answer the same question.

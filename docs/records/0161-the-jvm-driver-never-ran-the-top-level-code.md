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

---

## What the new row is, measured before touching it

`symbol-keyed-map` at 3.35x is 25.17 us against a reference's 7.51, and the
first two instruments say it is neither of the things it looks like.

**It is not allocation.** 368 bytes an operation against the reference's 312 —
the two `NtsValue.ofObject(symbol)` wrappers built per iteration to look a key
up are scalar-replaced, exactly as record 0156 found for `map-and-set`'s numeric
keys an hour earlier. That check cost one run and it is the one I skipped last
time.

**And it is not work.** A fixed-count driver:

| | instructions/op | cycles/op | IPC |
| --- | ---: | ---: | ---: |
| hand-written Java | 304,435 | 91,880 | **3.31** |
| ours | **113,098** | 154,403 | **0.73** |

We execute **2.7x fewer instructions** and take **1.7x more cycles**. An IPC of
0.73 against 3.31 is not a small stall; it is serialisation.

The structural difference is visible without a profiler.
`IdentityHashMap` stores keys and values inline in one `Object[]` — `table[i]`
is the key reference and `table[i+1]` its value — so a probe compares the
reference it already has against one load. `NtsMap` stores `NtsValue[] keys`,
so a probe is `buckets[p]`, then `keys[slot]`, then that box's `.ref`: **three
dependent loads where the reference has one**, and 8,192 probes an operation
with nothing between them to overlap.

That is a claim about the shape and not yet a measurement of it — the table is
four entries and fits in L1, so eighteen cycles a lookup is more than a chase
through resident lines should cost, and the next instrument is a profile rather
than another counter. Written down here so the row does not get filed as
allocation, which is what it looks like and what I would have assumed.

**And priced, before the rewrite it would have justified: 3.7%.** The same probe
written twice — four entries, 8,192 lookups, two of them misses, differing in
nothing but whether the key is reached through a box:

| | instructions/call | cycles/call |
| --- | ---: | ---: |
| the key inline in the table | 423,292 | 72,990 |
| the key behind a box | 426,401 | **75,722** |

1.007x and 1.037x. The extra dependent load is real and it is nearly free,
because four boxes are L1-resident and the loads pipeline. **So the second
hypothesis on this row is refuted too**, and `NtsMap`'s `NtsValue[] keys` is not
what makes it 3.35x.

Two hypotheses, two instruments, two refutations, and no rewrite spent on
either. What the row *is* remains open: 13.8 instructions a probe against the
probe's 52, and 18.8 cycles against 9.2 — an IPC of 0.73 where the same lookup
written by hand gets 5.6. The next instrument is a profile, and after two wrong
guesses it should not be a third guess.


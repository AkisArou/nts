# 0146 — Hand-written Java over our wrapper lands within a third of a percent

`array-predicates` is 4.28x hand-written Java, the largest in-scope row on the
board, and I had it filed as a codegen problem: a profile said 44.9% of it was
array construction. It is not a codegen problem. Over the same data structure a
person writes what we emit, to within 0.3%, and the whole 4.26x is the data
structure.

## The instrument, because the row's own timing cannot decide anything

The bench harness says this row varies **1.22x between runs of the same binary**
and its reference 1.27x. That is larger than most changes worth making, so a
timed A/B on it is theatre. A fixed-count driver — call `predicates` N times, no
timing — measured at N and 2N and subtracted, gives instructions per operation
with startup and warmup removed:

    (I(400k) - I(200k)) / 200k

Four repetitions per point, medians. The spread between repetitions is ~1.5%,
which is the resolution.

## Four programs, one answer

All four print `2090000.0`, so they are the same program.

| | instructions/op | vs `int[]` |
| --- | ---: | ---: |
| hand-written Java, `int[]` (the published reference) | 32,243 | 1.00x |
| hand-written Java, `double[]` | 32,745 | **1.02x** |
| hand-written Java, over `nts.rt.NtsArrayD` | 137,105 | **4.25x** |
| **ours** | **137,478** | **4.26x** |

The third row is the experiment: the same loops a person writes, but reaching
the elements through the shipped runtime class instead of a bare array. It is
not a reference anybody would publish. It is the only way to ask what our
codegen costs *given* the representation it is handed.

**137,478 against 137,105.** There is no codegen gap on this row.

## Two predictions, both wrong, and one of them was about to cost a day

**"Widening the reference to `double[]` is worth 15-30%."** It is worth 1.6%.

I had five references audited and queued for rewriting: `array-predicates`,
`arrays`, `array-from`, `array-methods` and `array-mutations` all declare
`int[]` where the TypeScript says `number[]` and this lane emits `double[]`.
The goal's rule forbids it — *no field narrower than the f64 a TypeScript
`number` is* — and the comments in those files argue back, at length, that the
narrower reference is the deliberate harder one and that our f64 element width
is a real gap the reference should not hide.

Both sides of that argument assumed the width was worth something. On this row
it is worth 500 instructions out of 105,000. The rule should still be kept,
because a rule that only binds when it is cheap is not a rule — but it is a
tidying job, not a correction, and it does not move a column.

**"The clear above the length is 9% of the row."** It is under 0.5%.

`keepFirst` zero-filled every slot above the new length, and a `filter` compiles
to allocate-at-source-length, truncate to nothing, push into the capacity — so
the clear was writing 259 slots that the pushes were about to write again, eight
times an operation. Removing it (and moving the hole-filling into `set`, the
only place a hole can be opened) is correct, gated green at 107 of 108, and
measured:

| | instructions/op | cycles/op |
| --- | ---: | ---: |
| with the clear | 137,478 | 29,313 |
| without it | 136,992 | 29,984 |

Instructions fall 0.35%; cycles move by less than the sign is stable across two
estimators. **Reverted.** I priced `Arrays.fill` at 259 scalar stores. C2
compiles it to a vectorised fill of about 65, against a per-operation budget of
137,000 — 0.6% before any measurement, had I done the arithmetic first.

## What the 105,000 actually are

Per element visit — 6,037 of them per operation — the bare array costs 5.3
instructions and the wrapper costs 22.8. Six or eight of those seventeen are
the obvious ones: `get` loads `a.length`, compares, loads `a.items`, and then
the JVM bounds-checks the array again, because our check is against a *field*
and the verifier's is against the storage.

The rest is not additive. `every` walks all 259 elements and is never false —
a counted loop over a `double[]` that C2 vectorises, and cannot vectorise
through a helper whose bound is a mutable field. In the `filter` loop it is
worse: `push` stores `kept.length` and `kept.items`, both `NtsArrayD` fields,
so type-based aliasing forces `xs.length` and `xs.items` to be reloaded every
iteration. Two `NtsArrayD` allocated in the same method are not provably
distinct to C2 at the field level.

So the wrapper does not add a constant per element. It forfeits the loop
transformations that make the bare array fast, which is why the ratio is 4.2x
and not the 2.1x that seventeen extra instructions would predict.

## This is the `arrays_can_grow` experiment, finally run

It is the second of the three measurements the JVM plan says decide designs, and
it has been listed as not-yet-run since the plan was written. The plan's own
words: *"If the cliff is real, push upstream for per-array analysis — `hir::escape`
and `hir::elements` already work per-array."*

**The cliff is real and it is 4.25x.** One `push` anywhere in a program puts
every array in it behind the wrapper; in this case both arrays genuinely grow,
so per-array analysis would not save this row — but the number is now measured
rather than assumed, and it is the largest single multiplier found on this lane.

What is mine is the wrapper's implementation, and the two things worth trying
are both about the reload rather than the check: storage that C2 can prove does
not alias, and a bound it can hoist.

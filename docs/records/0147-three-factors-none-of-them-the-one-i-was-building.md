# 0147 — Three factors, none of them the one I was building

Record 0146 established that `array-predicates`'s 4.26x is the growable-array
wrapper and not our codegen: hand-written Java over `NtsArrayD` lands within
0.3% of what we emit. This is the follow-up that asks *which part of the
wrapper*, by writing the same program nine ways and counting instructions.

All nine print `2090000.0`. Instructions per operation, from a fixed-count
driver measured at 200k and 400k and subtracted, four repetitions, medians;
the repetition spread is ~1.5%.

| # | counter | storage | bounds test | instr/op | vs `int[]` |
| --- | --- | --- | --- | ---: | ---: |
| R1 | `int` | bare `int[]` | implicit | 32,243 | 1.00x |
| R2 | `int` | bare `double[]` | implicit | 32,745 | 1.02x |
| R5 | `int` | hoisted, **and the filter's write** | implicit | 39,891 | 1.24x |
| R4 | `int` | hoisted | implicit | 69,119 | 2.14x |
| R7 | `int` | hoisted in mutation-free loops only | implicit | 89,993 | 2.79x |
| R9 | **`long`** | hoisted | implicit | 102,259 | 3.17x |
| R3m | `long` | field, per access | in the helper | 119,008 | 3.69x |
| R8 | `long` | hoisted | **spelled out** | 125,119 | 3.88x |
| R3 | `long` | field, per access | in the helper | 137,105 | 4.25x |
| — | ours | | | **137,478** | **4.26x** |

## Three factors, and I had the order wrong

**The `i64` loop counter is the largest single one.** R9 against R4 — same
hoisting, same absence of a test, the counter `long` instead of `int` and the
subscript `x[(int) i]` instead of `x[i]` — is 102,259 against 69,119, **32%**.
A `long` induction variable is not a counted loop to C2: no range-check
elimination, no unrolling, no vectorisation. `array.len` is typed `i64` and the
counter that compares against it is typed to match, so every growable-array walk
in this compiler is in the shape C2 declines to transform.

**Hoisting the storage is second**, R3 against R9, 25%. `get` reloads `a.items`
and `a.length` per element. It is worth saying that C2 does not do this itself
*even in a loop containing no store at all*: R7 hoists by hand in exactly the
three loops where nothing could alias, and still saves 34% over R3.

**The bounds test is third and it is not free even against locals.** R8 is R9
with the refusal spelled out — two compares against hoisted locals, no call —
and it costs 22%. This is the one that killed the design I was about to build.
I had planned to hoist the storage and keep the test, on the reasoning that a
compare against a local is cheap. It is cheap; what it is not is a shape C2
recognises. The `int` counter, the array's own length as the bound, and the
absence of a throwing arm are one package, and removing any of the three
forfeits the whole transformation.

## The two things I got wrong, in the order I got them wrong

**A one-line runtime change measured 12% and the 12% was not there.** R10
replaced the helper's refusal — `new IllegalStateException("out of range " + at)`
— with a preallocated throw, and came out 12% under R3. A one-liner worth 12% of
the largest red row is exactly the kind of result worth distrusting, so I added
the control I had skipped: **R3m**, the same simplified class with the
*original* string-building refusal. 119,008 against R10's 119,749. The refusal
path is worth nothing. All 12% was the difference between my stand-in class and
the shipped `NtsArrayD`, which I had been treating as the same thing across six
measurements.

That 13% between `MiniArr` and `NtsArrayD` is real and unattributed. It is the
`MAX_ARRAY` guard on every `push`, `growCapacity` against `Math.max`, or
something not yet named; ~2,300 pushes an operation and 7.7 instructions each.
It is in scope and it is not the headline.

**And `Arrays.fill` was never the cost.** Record 0146 has the numbers; the short
version is that I priced a fill at its trip count instead of at what C2 does to
it, and it was 0.6% before any measurement had I done the arithmetic first.

## What this hands to whom

The largest factor is not mine. `array.len` typed `i64`, and the induction
variable that follows it, is `hir`'s — the same upstream fact as the pending
`nts-i32-index` diff, now with a number: **32% of a 4.26x row**, and the row is
the largest in-scope one on the board.

Mine are the second and third, and they are one change rather than two, because
the measurement says they do not separate: hoisting without dropping the test
buys 9% (R3 → R8), and hoisting *with* it buys 25%.

Composed, the ceiling is R5 — **1.24x hand-written Java over a bare array,
from 4.26x** — and the remaining 24% is the wrapper's construction and the
`push` the filter cannot avoid.

---

## Correction, same day: the 1.6% was measured with the wrong instrument

Everything above is about instructions per operation, chosen because the row's
own timing varies 1.22x between runs and cannot resolve a 10% change. That was
the right instrument for the three factors it was pointed at, and **it is the
wrong instrument for element width**, because width does not change how many
instructions you execute. It changes how long each one takes.

Widening the reference from `int[]` to `double[]`, both instruments, four
repetitions, two-point:

| | instructions/op | cycles/op | IPC |
| --- | ---: | ---: | ---: |
| `int[]` | 33,139 | 6,969 | **4.76** |
| `double[]` | 35,717 | 13,293 | **2.69** |
| | +7.8% | **+90.7%** | |

Nearly the same instructions and **1.9x the cycles**. This row *stalls*, and I
reached for the counter that is blind to stalling.

The mechanism is not cache capacity -- 259 elements is 2 KB against 1 KB and
both are L1-resident. It is the compare. `some`, `every` and `findIndex` all
break out of their loop on the comparison's own result, so the compare's latency
is the loop-carried dependence, and `dcmpl` against `if_icmplt` is several
cycles against one. The `filter` writes are the same shape.

So the published effect of correcting the four `int[]` references is not the
tidying job this record called it:

| row | with `int[]` | with `double[]` |
| --- | ---: | ---: |
| `array-predicates` | 3.28x | **1.71x** |
| `array-methods` | 1.67x | **1.18x** |
| `arrays` | 1.35x | **1.02x** |
| `array-from` | 2.39x | **1.95x** |

**Four rows moved in our favour and none of it is code generation.** It is the
correction of references that were faster than the program they stand for, and
a reader discounting the column should discount exactly this much of it. The
gap it was hiding is real and is upstream: a TypeScript `number` is an f64, this
lane emits `double[]`, and a Java programmer writing the same loops over the
same values gets `int[]` for free. That belongs in a message to `hir` with a
number on it, which is where it now is -- not in a ratio that is supposed to be
about what this backend emits.

And the fifth reference moved the other way. `array-mutations` was an
`ArrayList<Integer>`, which boxes what the compiled program keeps unboxed;
replacing it with a hand-written growable `double[]` made the reference
**slower**, 2.03 us to 2.48 us, and the row went 1.06x to 0.68x. An `Object[]`
of small `Integer`s moves four bytes an element under compressed oops where a
`double[]` moves eight, and `ArrayList`'s shift and splice are `System.arraycopy`
over that. The rule that forbids the boxing is still right; the reasoning
usually given for it -- that boxing must be costing the reference -- was not
true here, and the row is one we win by less than the old number said rather
than more.


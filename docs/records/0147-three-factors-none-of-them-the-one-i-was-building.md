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

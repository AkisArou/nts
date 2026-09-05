# 0149 — The boxed erased value costs nothing where it does not escape

The JVM plan lists three experiments that decide designs and says to run each
before building what it would justify. The first is *does C2 scalar-replace what
this backend emits* — the `Erased` representation, boxed `NtsValue` against a
decomposition into three slots — and it has been listed as not-yet-run since the
plan was written. Here it is.

`NTS_BENCH_ALLOC=1`, bytes allocated per operation, ours against the
hand-written Java reference for the same program:

| case | ours | Java | published ratio |
| --- | ---: | ---: | ---: |
| `erasure-unknown` | **0.00** | 0.00 | 1.00x |
| `erasure-typed` | **0.11** | 0.00 | 1.00x |
| `optional-chain` | **0.00** | 0.00 | **2.12x** |
| `in-narrowing` | **0.00** | 0.00 | 1.02x |
| `instanceof` | **0.00** | 0.00 | 1.09x |
| `absences` | 0.00 | 0.00 | 1.24x |
| `generic-classes` | 0.00 | 0.00 | 1.17x |
| `erasure-stored-typed` | 16,016 | 16,016 | 0.99x |
| `erasure-stored-unknown` | 16,016 | **56,016** | 0.96x |
| `upcast` | 65,536 | 65,536 | 1.03x |
| `map-and-set` | 65,952 | 52,864 | 1.85x |
| `array-from` | 8,280,864 | 6,232,944 | 1.98x |

**Zero means the allocation did not happen.** So the answer to the question the
plan reserved judgement on is: the boxed `NtsValue` is free wherever it does not
escape, and the escape analysis this backend was told not to rely on does the
job on every shape in the suite that asks it to.

The plan's own instruction was *"If replaced in the two non-stored cases, do not
build the scalarising path."* It is replaced. **Do not build it.** That is the
largest open design decision in the plan, settled negatively, and the reason to
write it down is that it stays settled — a future profile showing `NtsValue` at
the top of a stack is showing where the *work* is, not an allocation.

`erasure-stored-*` allocates because the value is stored, which is what those
cases exist to say, and it allocates **the same as the Java reference** —
16,016 both. On `erasure-stored-unknown` we allocate **3.5x less** than Java:
the reference boxes a `Double` per element where our `NtsValue` carries the
double in a field it already has.

## The surprise, in a direction I did not name

I predicted `optional-chain` would be non-zero, and said so before running it.
It builds an object per iteration and stores an erased closure into its field --
`object.new frame`, `field.set %10.0 = %16` -- which is the shape the plan flags
as the one JDK 21 cannot scalar-replace, since it has no `ReduceAllocationMerges`
and a `typeof` narrowing produces a merge at a control-flow join.

**0.00 bytes/op.** Both the object and the `NtsValue` go away.

Which means `optional-chain`'s 2.12x is not allocation, and I had it filed as
allocation. What is left in that loop is the call: a closure reached through a
field, null-tested, and invoked. That is where the next measurement on that row
goes, and it is a different kind of thing entirely.

## And it re-reads two rows that looked like erasure

`map-and-set` allocates 25% more than the reference, not 85% -- so most of that
row is not the allocation either.

`array-from` allocates 8.28 MB an operation against the reference's 6.23 MB, and
the 2 MB difference is the *width* again rather than any surviving `NtsValue`:
`Array.from(set)` builds a `double[]` of 256 elements 2,000 times, where
`Set.toArray` builds an `Object[]` of 256 references, which is half the bytes
under compressed oops. If the erased key `nts_map_key_at` returns had survived,
the gap would be 12 MB rather than 2.

## What this does not say

Nothing about ART, which has no C2 and much weaker escape analysis, and where
the plan expects a different answer. The argument for building the scalarising
path was always partly *"if the HotSpot result is even marginal, build it for
ART"*. It is not marginal -- it is zero on five rows -- so the ART case has to
be made on ART, with a DEX pipeline that does not exist yet, and not on this.

# The scan cannot lose its bounds check, and the reason is a field

`benches/cases/json-parse` exists now, and it published with **our JVM backend
2.8x ahead of our own C** on the same program. A gap that size between two of
our own backends is a statement about the C lane, so I profiled it. The first
answer was allocation and is fixed. The second is this, and it is not fixed.

## What the loop compiles to

`Scanner#readString` is 15.4% of the parse profile and its inner loop is the
shape every scanner has: walk code units until a quote.

    v17 = v0->length;
    v200 = (double)v17;
    v18 = v16 < v200;
    v21 = nts_str_char_code_at(v16_source, v16);

`nts_str_char_code_at` is how `StringUnitAt { checked: true }` emits. The fast
form is `nts_unit` and this loop never reaches it, so every character costs a
call with a test inside it.

## Why elimination cannot fire, which is not the length

The obvious suspect is the bound. `Scanner` caches `readonly length: number`
from `source.length` in its constructor, and a compiler cannot see those are the
same number -- so `at < this.length` says nothing about `at` against *this
string*, and the field is re-loaded and widened to a double every iteration.

**That is real and it is not the cause.** Hoisting `source` and its length into
locals, so the guard is literally `at < source.length`, changed the emitted C in
exactly the intended way and moved the row **not at all**: 1.83 ms to 1.83 ms,
with LLVM 1.83 to 1.81, which is noise. Reverted rather than kept, because a
change that measures zero on the row it was aimed at is churn in somebody else's
spec-bearing module.

The cause is the other half of the check. A bounds check asks
`0 <= index < length`, and `at` is seeded from `this.at` -- a **mutable field**
whose range nothing bounds. The upper half was already provable and the lower
half never was.

## And the source of the widening, which no source change reaches

`nts facts` settles it rather than leaving it inferred:

    %15  f64  [-2147483648, +inf]      <- `at`, seeded from `this.at`
    %17  i32  [0, 2147483646] whole    <- the length

The upper half was always fine. The lower bound is `INT_MIN` because `Scanner.at`
is **one field written from every method**, and the join takes the worst: line
208 stores `at - 1`, and line 231 stores the return of `numberFailurePosition`,
which takes `this.at` as an argument and so widens with it to a fixed point at
`[-2147483648, +inf]`.

**A second experiment ruled out the source side.** Adding `if (start < 0) throw`
before the loop -- a statement rather than a ternary, because record 0217 says a
refinement does not survive a phi -- is semantically a no-op, since a scanner
position is never negative. It moved the row from 1.83 ms to 1.82 ms and the
emitted C still contains four `nts_str_char_code_at` and no `nts_unit`. Reverted.

So neither half of the obvious source-level fix works: hoisting the length gives
the upper bound the analysis already had, and asserting the lower bound gives a
fact the loop-carried value does not inherit. **This is a compiler gap and the
TypeScript cannot route around it**, which is worth more than the diagnosis
alone -- it says where the work has to happen.

## What that generalises to

Every scanner in this tree has this shape: a position field, a local seeded from
it, a loop that only increases it. `Scanner#readString`, `readMemberKey`,
`Scanner#expectWord` and `scanNumber` are the same four lines with different
terminators, and together they are about a third of the parse profile.

So the missing fact is not about strings and not about loops. It is **a range
for a field**, and `eliminate_checks` already takes a `fields::FieldFacts` --
which carries lengths and not ranges. Extending it to carry an interval for a
field written only with non-negative values would settle all four at once, and
would settle the same question the JVM lane arrived at from `symbol-keyed-map`:
an f64 coming from a number-typed field or element is integral and in range, and
nothing proves it.

That is the same missing analysis record 0217 describes from a third direction.
Three rows, three lanes, one gap:

- `&&` loses its refinement at a boolean phi, so a range check proves nothing.
- An accumulator's *other operand* arrives as an f64 from a map value.
- A scan index arrives as an f64 from a position field.

None of them is a special case of the others and all three want interval facts
to survive one more hop than they do.

## What was actually banked

The allocation half, which was 22% of the profile and is now 13%: every scalar
`JsonValue` allocated three empty arrays it could never put anything in. 1.35x
on the compiled parser, and everything else got faster too because sharing an
immutable empty array helps a host as well.

Recorded together because the pair is the lesson. The same profile produced one
change worth 1.35x and one worth nothing, and the difference was not how
plausible they looked beforehand -- the bounds one looked *better*.

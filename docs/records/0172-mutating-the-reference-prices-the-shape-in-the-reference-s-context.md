# 0172 — Mutating the reference prices the shape in the reference's context

`benches/cases/array-methods` published at 1.19x. The prepared HIR says why in
one glance:

    %65 = call.extern nts_array_index_of(%2, %97) : f64
    %108 = convert %65 : i64
    %106 = convert %108 : i32
    %66 = add %57, %106 : i32

A JavaScript `indexOf` answers a number, so `hir::runtime` types it `f64` and
all three backends agree about that -- correctly, because that table has to stay
the single answer about conversions. And the helper's own loop counts in an
`int` and widens on the way out, so the widening and the narrowing are both
this backend's, three times a round, 256 rounds.

## The price I put on it, by the method that worked an hour earlier

`widen.rs` prices a representation by mutating the reference: one file, one
variable, same checksum. So: `indexOf` and `lastIndexOf` made to return `double`
with the caller casting back.

    original     1,426.7 ns
    round trip   1,751.2 ns     +22.8%

More than the whole gap the row had. I built `intcall.rs` on the strength of it.

## What it actually bought

    array-methods   1.19x -> 1.14x     1.69 us -> 1.61 us     4.7%

**Off by five.** The change is right, the direction is right, and the number I
predicted was the number for a different program.

The likely mechanism, and it is the point rather than a footnote: in *our* code
the helper inlines and `i2d` meets `d2l; l2i` across the inline boundary, where
C2 folds some of it. In the mutant the cast chain sat in the caller's own source
and C2 kept it. Two compilers, two contexts, one shape -- and the residue after
optimisation is a property of the context, not of the shape.

So the rule I have been sharpening all day needs a third clause:

> Price the replacement, and price the share -- **and price them where the
> change will happen.**

Mutating the reference measures what the shape costs *the reference*. That is
the right instrument when the two contexts are the same, which is why it worked
for `widen`'s counter and for the formatter ceiling, where the mutation was a
direct A/B of the same call. It is the wrong instrument when your compiler's
surrounding code differs -- and the more of the shape your own optimiser has
already removed, the more the reference over-reports.

## Kept, and why

4.7% is small and it is a deletion: two conversions gone at every index lookup,
no new path, `hir::runtime` untouched, every other lane sees the `f64` it always
saw. The `I` forms are the loop the `double` forms already ran, and the widening
is now one place instead of two.

The index is exact in an `int` by construction -- it is the loop counter, or -1
-- so this is a representation and not a second answer, which is the same
latitude this backend takes deciding an array is a `double[]`.

## The bug the emitter's own accounting caught

The first version emitted the `int` call and left `Convert` reading the operand's
*declared* type:

    NTS4001 emitting %108 moved the operand stack from 0 to -1, and an
    operation must leave it as it found it

An `int` pushed and a `double` popped. Not a wrong number -- a stack that stops
balancing, reported at the operation rather than a block later, which is what
`Code` tracking depth by construction is for.

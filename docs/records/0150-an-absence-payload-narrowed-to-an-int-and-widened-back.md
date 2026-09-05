# 0150 — An absence payload narrowed to an int, and widened back

`optional-chain` is 2.12x hand-written Java and I had it filed as allocation:
it builds an object per iteration and stores an erased closure into its field,
which is the shape the plan says JDK 21 cannot scalar-replace. Record 0149
measured it at **0.00 bytes/op**. So the row is something else, and this is what.

## Five programs, each one layer further from the reference

A fixed-count driver, 100,000 iterations a call, two-point at 200 and 400 calls,
three repetitions, medians. Every variant prints `300000.0`.

| | instructions/iteration | cycles/iteration |
| --- | ---: | ---: |
| the reference: a `Fn` field, a null test, a call | 11.1 | **1.83** |
| + the field holds an `NtsValue` | 13.5 | **2.06** |
| + the absence carried as a tag and a payload | 13.2 | **2.96** |
| + the payload narrowed to `i32` and widened back | 16.6 | **4.17** |
| + the two tag tests short-circuited instead of `ior`ed | 16.7 | 4.20 |
| **ours** | **17.1** | **4.31** |

The ladder reproduces the emitted program to within 3%, which is the evidence
that it is measuring the right thing.

## What each layer is worth

**The erased field is +13%**, and it is the part that is mine. `Held.fn` is an
`NtsValue`, so the null test is `getfield fn; getfield ref; checkcast; ifnull`
where the reference has one `ifnull`, and the call reads `ref` and casts a
second time. Real, small, and not the row.

**The tag and payload pair is +44%.** Two `int`s carried across a join where the
reference carries one reference.

**Narrowing the payload is +41%, and it is the largest single piece.** The HIR:

    %24 = call Closure0#call(%39, %23) : f64
    %52 = convert %24 : i32
    jump b9(%43, %52)
    b9(%25: u32, %40: i32):
    ...
    b12(%35: i32):
    %50 = convert %35 : f64
    %36 = add %3, %50 : f64

The closure returns an `f64`; the absence payload is typed `i32`, so the result
is narrowed on the way in and widened on the way out, once per iteration. In
bytecode that is `d2i` and `i2d` — `cvttsd2si` and `cvtsi2sd`, the second with
a false dependency on its destination register — on a loop-carried path.

The payload's type is free. The other arm supplies `const 0 : i32`, and nothing
reads the payload except the `convert` back to `f64`. Typed `f64` on both arms,
**both conversions disappear and nothing replaces them**.

## The hypothesis that measured zero

The emitted code tests the tag twice and materialises both answers:

    iload 20; iconst_0; if_icmpeq ...   -> a boolean in a slot
    iload 20; bipush 7;  if_icmpeq ...  -> a second boolean in a slot
    ior; ifeq

That is the *materialised boolean* named in this session's standing goal as
known and not yet acted on, and it is two per iteration rather than the rare
case the note assumed. The obvious change is to short-circuit an `or` of two
comparisons that feeds a branch, which the emitter is already structured to do
for a single comparison.

**Priced before building: 4.17 cycles against 4.20. Zero.** C2 turns the
materialised booleans back into branches, so the `|` form and the `||` form
compile to the same machine code. Records 0102 and 0109 said this and I went
looking anyway; the difference this time is that it cost one probe rather than a
day, because the probe came first.

So: **do not build the short-circuit fusion.** It is not that it is small. It is
zero, and the reason is that C2 does it.

## Where each piece goes

The narrowing is `hir`'s — the payload's type at the join — and it is worth 41%
of a 2.12x row on this lane, with nothing to trade against it on the others: the
C backend would also stop emitting two conversions. It is filed with a number.

`widen.rs` could do it here without waiting, and it is the same shape as
`narrow.rs`: this backend choosing a representation the IR did not. But that
file already carries two measured losses for widening locals -- on `closures`,
removing exactly one `i2d` from a 103-instruction method cost **30%** -- and its
rule is "widen what removes a conversion from a *field* access". This is not a
field. What makes it different from the losing cases is that the class here is
an f64 that was narrowed *only in order to be widened back*, so widening deletes
two conversions from a loop and adds none, where `closures` deleted one and
relocated another. That is a tighter predicate than "widen locals" and it is the
one worth trying — with the losses on the record as the reason to measure the
whole suite rather than the row.

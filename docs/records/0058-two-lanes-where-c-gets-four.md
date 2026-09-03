# 0058 — Two lanes where the C backend gets four

0057 closed `absences` and left a sharper number behind it: on the same HIR,
from the same fifteen passes, the C backend ran it in 188.7ns and the LLVM
backend in 403.1. Both are clang at `-O2 -flto`. This is what the difference
turned out to be, measured rather than argued, including two diagnoses that were
wrong.

## Not the instruction count

The obvious first guess is that one backend emits more work. It does not:

    bench_run()      instructions   vector   branches
    nts C                     563      302         31
    nts LLVM                  550      297         37
    C++                       245      158          8

Near-identical, at a 2.1x difference in runtime. Whatever it is, it is not how
much code.

## Not the call, either

The LLVM backend emits string truthiness as a call, where the C backend expands
it inline:

    v100 = v28 != 0 && v28->length != 0;                  /* C */
    %v100 = call zeroext i1 @nts_string_truthy(ptr %v28)  ; LLVM

An opaque call in a loop blocks vectorization outright, and it does — compiled
alone, the module gets 13 vector instructions against the C's 302. Giving the
module an inlinable body restores it.

But it restores it to *exactly* what the linked binary already had, 14 `paddd`
and 28 `paddq`, because `-flto` inlines the call anyway. So this is a real
defect of the emitted IR and it is worth **no** measured time in the shipping
configuration. Recorded as a finding rather than fixed, because a change that
moves no number is a change that has not been justified.

## The vectorization factor

    vector types, ours     87 x <2 x i64>   46 x <2 x i32>
    vector types, C's     123 x <4 x i32>

The C's loop vectorizes four lanes at a time and ours two. That is the whole
2.1x, and the cause is the `i64`: two of them fill a 128-bit register where four
`i32` fit. `%vec.ind = phi <2 x i64>` is the induction variable, and any `i64`
live in the loop caps the factor.

Narrowing every `i64` in the specialized function by hand and relinking:

    narrowed   187.1 ns      C backend  187.3 ns      C++  186.9 ns

The gap closes completely. **The whole of what this row still pays is width.**

## Two diagnoses that were wrong, and one caveat that matters

The string-length chain was the first suspect — `zext i32 length to i64`, added,
truncated back, which is exactly the shape `TruncInstCombine` narrows. Narrowing
it by hand changed nothing: 14 and 28 before, 14 and 28 after. The second was
the call above, which turned out to cost nothing once LTO was accounted for.

And the experiment that *did* work is not a fix. `n = 256 + (seed | 0)` reaches
2^31+255, so an `i32` induction variable genuinely overflows and the `i64` the
specializer chose is right. Narrowing it by hand proves the prize; it does not
propose the method.

## Where the width actually sits, and a fix that was wrong

The first version of this record proposed one: the payload chain the split
introduced is `i64` because its source is the loop counter, its only use is
`toint32`, and addition is congruent modulo 2^32 — so narrowing *that* is sound
where narrowing the counter is not.

It is sound, and it is worth nothing. Narrowing the payload chain by hand, with
the truncation placed on the edge where the counter enters it, leaves the output
exactly as it was: 87 `<2 x i64>`, unchanged to the instruction.

The width that matters is the **induction variable**, and that one is not
narrowable by us: `256 + (seed | 0)` reaches 2^31+255, so `i64` is the right
type and an `i32` counter is wrong.

## What clang does that we cannot, still unexplained

The C backend hands clang `int64_t` in the same places and clang narrows it
anyway — its vectorized loop carries `phi <4 x i32> [ <i32 0, i32 1, i32 2,
i32 3> ]`, an `i32` induction variable, from a bound that does not fit in one.
So the transformation is available; something about our IR prevents it.

Four candidates were tested and every one of them is refuted:

    the string-length zext/add/trunc chain      no change
    the opaque `nts_string_truthy` call         no change under LTO
    the payload chain, narrowed soundly         no change
    redundant single-predecessor phis           no change

That is the state. The cause is measured and certain — width caps the
vectorization factor, and removing the width is worth the entire 2.1x. The fix
is not found, and four plausible accounts of it are now known to be wrong rather
than merely unverified. Whoever takes it next should start from what clang's
pipeline does to the C that it declines to do to our IR, rather than from
another guess about which value is too wide.

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

## What the legal fix looks like

The payload chain the split introduced is typed `i64` because its source is the
loop counter — and its only use is `toint32`. A value whose every use truncates
to 32 bits can be carried at 32 bits, and narrowing *that* is sound where
narrowing the counter is not.

The evidence that the information is there: clang recovers it for the C backend
from C that says `int64_t` in exactly the same places. The C column is at parity
today because the C frontend's output gives LLVM more to work with than our IR
does. So this is not a missing fact, it is a lost one.

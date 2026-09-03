# 0068 — Seventeen spills, and none

`array-predicates` is one of the two rows 0067 established are *ours* — the C
backend's own program compiled through `clang -x ir` runs at 2156ns against
2147ns as C, so the ingestion path costs nothing there and the whole 1.24x is
what we emit.

This is what we emit.

## The comparison that isolates it

Two IR files for the same program: ours from `emit-llvm`, and clang's from the C
backend's `program.c` at `-O0 -Xclang -disable-O0-optnone`. Both through
`clang -x ir -O2 -flto`, both linked against the same three objects.

    from clang's IR   2134.5 ns
    from our IR       2681.6 ns
    C backend         2156.3 ns

Then `noinline` on `predicates__whole`, so both builds keep it a real function
and the same symbol can be disassembled in each:

    from clang's IR   151 instructions   0 stack accesses    7 register copies
    from our IR       171 instructions  17 stack accesses   15 register copies

**Seventeen spills against none.** Same six calls, same four `ucomisd`, same
four `cvtsi2sd` — the arithmetic is identical and the register allocator ran out
of registers on one of them.

## What it is not

Four hypotheses, each tested by editing the `.ll` and rebuilding:

    constants materialised as `add i32 0, N` (24 of them)   2650 vs 2688  noise
    single-predecessor phis substituted away (11 of them)   2650 vs 2688  noise
    `noinline` on the hot function                          2658 vs 2682  noise
    both foldings together                                  2650 vs 2688  noise

And it is not size: after `-O2` **our IR is smaller** — 207 instructions in 46
blocks against clang's 229 in 56 — and collapses to one function where clang
keeps three. Fewer blocks holding the same values is a longer live range, which
is the direction that causes spills, but no edit above moved the number.

## What is left to try

The live-range shape itself. Our IR arrives already in SSA with 52 phis and no
`alloca`s; clang's arrives as 238 `alloca`s and one phi, and `mem2reg` builds
the SSA. LLVM's allocator is tuned for what its own pipeline produces, and the
two forms are not equivalent inputs even when they mean the same thing.

That is a hypothesis and not a finding. What is a finding is the number: our IR
spills seventeen times in a function where clang's spills zero, and that is the
whole of this row's gap.

The other row that is ours, `absences`, now has eight refuted hypotheses. This
one has four. Both are spill-or-width problems in the same backend, and neither
is explained.

## What the spills are, which narrows it further

Every one of them is around a call, and four of the seven are `movsd`:

```text
movsd %xmm0,0x20(%rsp)   ...   addsd 0x20(%rsp),%xmm2
mov   %r12,0x28(%rsp)  -> call nts_release    -> mov   0x28(%rsp),%r12
movsd %xmm1,0x40(%rsp) -> call nts_array_grow -> movsd 0x40(%rsp),%xmm1
```

    ours    4 xmm spills   3 integer spills   6 calls
    clang   0              0                  6 calls

x86-64 has **no callee-saved xmm registers**, so a floating-point value live
across a call must be spilled. Ours keeps values live across `nts_release` and
`nts_array_grow`; clang's keeps none, with the same six calls. That is why every
integer-shaped fix below did nothing.

## And the two optimized IRs are the same

Not similar — the same, by every aggregate available:

    ours    100 instructions  11 phis  23 blocks  7 calls  10 loads
    clang    93 instructions  11 phis  23 blocks  7 calls  10 loads

    both:  0 double phis, 11 integer phis, 1 fadd, 12 integer adds, 2 sitofp

Same types, same counts, same control flow. One spills seven values and the
other spills none.

## Ten refuted

    constants materialised as `add i32 0, N`      noise
    single-predecessor phis substituted away      noise
    `noinline` on the hot function                noise
    both foldings together                        noise
    `reg2mem` (52 phis to allocas, mem2reg rebuilds)  noise
    `sink`, `slsr`, `separate-const-offset-from-gep`  noise
    `inbounds` on every GEP                       noise
    `i64` element indices instead of `i32`        noise
    `opt -O2` before `clang -O2`                  slightly worse
    `opt -O3` before `clang -O2`                  slightly worse

What is left is instruction **order**: two IRs that agree on every aggregate can
still interleave live ranges differently, and no aggregate can see that. Testing
it means comparing the two optimized functions instruction by instruction rather
than by histogram, which is where the next person should start.

The row is 1.25x LLVM-over-C and it is ours. That is a refusal with a reason,
and the reason is now four steps deeper than "17 spills": they are around calls,
they are mostly floating-point, x86-64 has no callee-saved xmm, and the IR that
produces them is indistinguishable in the aggregate from the IR that does not.

## Twelve refuted, and the thing that would answer it

Added since the list above:

    `inbounds` on every GEP                       noise
    `i64` element indices instead of `i32`        noise
    `opt -O2` / `-O3` before `clang -O2`          slightly worse
    `target datalayout` and `triple` on the module  noise
    runtime calls marked `noinline` at the site   **much worse** (3375 vs 2658)

The last one is informative rather than disappointing: LTO inlining the runtime
into this function is worth 27%, so the extra sixteen instructions ours carries
over clang's are *earned*, not waste.

And the ordering hypothesis is refuted too. The two optimized functions are not
merely similar in aggregate — they are in the same order, instruction for
instruction:

```text
ours     clang
  4        3     tail call nts_array_new
 13       12     sitofp i32 -> double
 22       21     sitofp i64 -> double
 23       22     tail call nts_array_push
 33       32     fadd double
103      108     tail call nts_array_new_uninitialized
```

Both carry `nounwind` on every runtime declaration. Both get the same datalayout.
Same types, same counts, same control flow, same order — and one spills seven
values while the other spills none.

## Why this stops here

What is left is the register allocator's own decisions, and this clang cannot
show them: `-mllvm -stats` prints nothing and `-debug-only=regalloc` is
unavailable, because both need an assertions build of LLVM. Every remaining
hypothesis is a guess about a black box, and twelve of those have already been
wrong.

The row is 1.25x, it is ours, and the honest state is: measured to the
instruction, mechanism identified (values live across calls, four of seven of
them floating-point, and x86-64 has no callee-saved xmm), cause not found. The
next step is an assertions build of LLVM, not another edit to the `.ll`.

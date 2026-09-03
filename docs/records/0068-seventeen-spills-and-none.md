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

# 0045 — Thirty-two bytes of address

`case-convert` was the last row that lost to node. The C backend ran it in
2.63us and the LLVM backend in 3.36us, and the published ratio is the LLVM
backend's, so the row read 1.13x — a loss on a workload where one of our two
backends was already 12% faster than node.

The gap was not in either backend. It was where a function landed.

## What it was not

Instructions per operation, first, because that is the number a codegen
difference shows up in. `perf stat` divided by the operations each binary
reported:

    nts C      81,333 instructions per operation
    nts LLVM   81,503 instructions per operation

Two tenths of a per cent apart, for a 28% difference in time. So the two
backends were emitting the same amount of work and one of them was executing it
much more slowly.

## What it was

    nts C      IPC 5.34    0.51 branch misses per thousand instructions
    nts LLVM   IPC 4.15    1.53 branch misses per thousand instructions

Three times the mispredictions, and `perf record` put 75% of them inside
`nts_str_case_convert` — which is C, in `runtime/c/nts_unicode.c`, compiled once
and linked into both.

So the same function, from the same source, mispredicting three times as often
in one binary as in the other. `objdump` on both:

    nts        <nts_str_case_convert>  492 instructions, 96 vector, at 0x4eb0
    nts LLVM   <nts_str_case_convert>  492 instructions, 96 vector, at 0x4ed0

Byte for byte identical. The only difference in the entire function is its
address: forty-eight bytes into a cache line against sixteen.

That is branch-predictor aliasing. The predictor indexes on address bits, two
branches that collide in the index share a counter, and which branches collide
is decided by where the code sits. Thirty-two bytes of address, three times the
mispredictions, 28% of the row.

## Why it mattered more than one row

It is unstable. The address of a function depends on everything linked before
it, so an unrelated change to the runtime moves it — and this is what was behind
a measurement that made no sense earlier in the same sitting:

    benchG   case-convert   nts C 3.78   nts LLVM 2.79   0.94x node
    benchH   case-convert   nts C 3.77   nts LLVM 2.79   0.94x node
    benchI   case-convert   nts C 2.86   nts LLVM 3.75   1.26x node

The same two values swapping which backend they belonged to, and a 35% swing on
a row the README publishes, between runs whose only difference was allocation
*counting* in the map. It read like an instrument fault and was investigated as
one. It was this: the change moved the function, and the two backends traded
sides of the same coin.

## The fix, and the one that was not

`__attribute__((aligned(64)))` on the function. Both backends then land on the
good side of the alignment rather than one each:

    before   nts C 2.63   nts LLVM 3.36   1.13x node
    after    nts C 2.49   nts LLVM 2.54   0.85x node

Both are faster than *either* was, and the row stops moving between runs.

The same attribute on `nts_release` — 12% of this benchmark's instructions and
12% of its branch misses — measured nothing, twice, and is not in the tree. A
hot function whose misprediction rate is already low has no aliasing to lose,
and alignment is not a thing to apply on principle: it costs padding in the
instruction cache and buys only what it can be shown to buy.

## What this says about the other rows

Two backends that differ by ten per cent on a row with the same instruction
count are not telling you about the backends. Before treating such a gap as
codegen quality, the check is cheap and is now written down: instructions per
operation from `perf stat`, then `objdump` on the hot function from both
binaries. If the disassembly matches, the difference is placement, and the
question is alignment rather than lowering.

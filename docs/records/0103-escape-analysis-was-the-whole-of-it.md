# 0103 — Escape analysis was the whole of it

`benches/cases/generator`, 3.41x hand-written Java. One flag settles it:

| | us/op |
| --- | ---: |
| hand-written Java, escape analysis **on** | 172.7 |
| hand-written Java, escape analysis **off** | **623.7** |
| nts (JVM), escape analysis on | 589.9 |
| nts (JVM), escape analysis off | 601.0 |

Turning escape analysis off in the reference makes it **slower than us**. Our
generated code is not the problem: we are simply not getting an optimisation
the reference gets, and the entire gap is that one thing.

## What the counters said first, and why they were the turning point

Fixed-count drivers, 20,000 operations each, same checksum:

| | nts (JVM) | Java | ratio |
| --- | ---: | ---: | ---: |
| time | 590.7 us | 172.5 us | 3.42x |
| instructions | 165.1e9 | 132.2e9 | 1.25x |
| branches | 16.711e9 | 16.700e9 | **1.00x** |
| cycles | 134.4e9 | 39.4e9 | 3.41x |
| IPC | **1.23** | **3.36** | |

**Identical branch counts and only 25% more instructions, against 3.4x the
cycles.** That is not a code-size problem in any form; it is a stall. A
dependency chain through memory looks exactly like this, and the reference's
`UpTo` has no memory to chain through because its fields are in registers.

## Why ours does not scalar-replace

The frame reference occupies **four local slots** in `work$whole` — 11, 14,
15 and 16, with copies between them — and there are **two `new upTo$frame`
sites** feeding it. JDK 21 has no `ReduceAllocationMerges`: a reference that
can come from two allocations, or that is merged at a control-flow join, is
not scalar-replaced *at all*. The plan for this backend wrote that down as a
hazard for the erased representation and it turned out to bind here instead.

The reference does the same thing in source — `UpTo walk = new UpTo(...)`
inside a loop — but it is one local with one definition, so there is no merge
and no phi.

Ours is loop-carried through SSA block parameters, and `edge_copies` moves it
between slots on the way round. That copy is the defect.

## Five hypotheses refuted before this one, all of them about the wrong thing

Kept, because the sequence is the lesson:

1. **Bytecode volume** — record 0102. 196 → 160 bytecodes bought exactly zero.
2. **The definite-assignment prologue** — 30% of the per-element body, and
   dead stores are the first thing a JIT removes.
3. **The inlining budget** — `FreqInlineSize=1000`, `InlineSmallCode=10000`
   and `MaxInlineSize=200` each changed the decision counts *not at all*, which
   I only checked after the timing said nothing moved.
4. **Allocation** — `event=alloc` reported zero samples.
5. **The method I was studying.** `async-profiler` put 92.5% in `work$whole`
   and 7.4% in `upTo__resume`, after an hour spent counting bytecodes in the
   resumption.

Every one was a statement about *emitted code*. The answer was a statement
about *what the JIT declines to do with it*, and no amount of reading the
bytecode would have produced it.

## The rule

**Profile before hypothesising, not after four refutations.** The four cost an
afternoon; `-XX:-DoEscapeAnalysis` on the reference cost one command and would
have worked at any point.

And the tell was there from the start: identical branch counts with triple the
cycles says *latency*, and latency is never an instruction count. I had that
number before three of the four refutations and read past it.

## What to build

Coalesce a block parameter with its incoming argument where their live ranges
do not overlap, so the frame occupies one slot with one definition. Record
0102 concluded coalescing was not worth building because it buys no bytecode
that costs anything — which was true, and the wrong reason to look at it. It
is worth building because the copy is what defeats escape analysis.

Two allocation sites merging into one reference may need more than coalescing;
if so, the second `new` is the thing to remove.

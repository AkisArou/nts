# 0106 — One field reproduced the whole gap

`benches/cases/generator`, 3.41x hand-written Java. The cause is an
`int` → `double` conversion per element, and the proof is that changing one
field in the reference reproduces our time to within 0.2%:

| | us/op |
| --- | ---: |
| reference, `double` counter | 172.5 |
| reference, **`int` counter, `double` limit** | **588.8** |
| nts (JVM) | **590.2** |

The generator counts with `let i = 0; while (i < limit)`. Both are `number` in
the source, which is f64. Number specialization narrows `i` to an `int32` --
correct, and normally an improvement -- and leaves `limit` a `double`, so
`i < limit` needs a widening on every element:

    inc       %r10d
    vcvtsi2sd %r10d,%xmm0,%xmm0      <- here
    vmovsd    0x10(%rsi),%xmm1
    vucomisd  %xmm0,%xmm1

`vcvtsi2sd` in its VEX form merges into its destination register, so it depends
on the previous value of that register. Reused across iterations, the
conversions serialise and the loop becomes latency-bound.

## Everything the counters said, in order, and what each was worth

| measurement | said |
| --- | --- |
| branches 16.711e9 vs 16.700e9 | identical control flow |
| instructions 1.25x | not a code-size problem |
| cycles 3.41x, IPC 1.23 vs 3.36 | **latency**, not throughput |
| allocation 0 B/op both, with EA on | not allocation |

The first three were in hand before any of the hypotheses below, and together
they said "a serialised dependency chain" from the beginning. A loop with the
same branches and triple the cycles is not doing more work; it is waiting.

## Six refutations, kept because the sequence is the lesson

1. **Bytecode volume** — record 0102. 196 → 160 bytecodes bought exactly zero.
2. **The definite-assignment prologue** — 30% of the per-element body, and
   dead stores are the first thing a JIT removes.
3. **The inlining budget** — three flags, and I checked afterwards that none of
   them changed a single inlining decision.
4. **The method under study** — the profiler put 92.5% in `work$whole`, after
   an hour spent counting bytecodes in `upTo__resume`.
5. **Escape analysis** — `-XX:-DoEscapeAnalysis` made the reference slower than
   us, which looked decisive. Both sides allocate **0 B/op** with it on; the
   flag disables scalar replacement *and* the register promotion downstream of
   it, and only the second mattered. See the correction in 0103.
6. **Bytecode size defeating escape analysis** — padding the reference to 149
   bytecodes still allocates nothing.

Five of the six were statements about *the code this backend emits*. The answer
was about **a type the middle end chose**, which no amount of reading the
bytecode would have produced, and which the assembly showed in one instruction
the first time it was printed.

## The general shape, and it is the second instance today

`awfy-bounce` is 1.60x for the same reason one level down: its `Ball` fields
were `double` where the reference's are `int`, priced at 1.14x by editing the
reference. Here the polarity is reversed -- our counter is `int` where the
reference's is `double` -- and the cost is 3.4x because the conversion sits on
a loop-carried dependency rather than beside one.

**A mixed-width comparison costs a conversion, and a conversion on a
loop-carried chain costs the loop.** Specialization is right to narrow a
counter and wrong to narrow it alone: the fix is that a value narrowed to `i32`
whose uses compare it against an `f64` should either take the other operand
with it or stay wide. That is `hir`'s decision, not this backend's.

## What this backend could do instead, and why it should not

The conversion could be hoisted, or the destination register zeroed to break
the false dependency -- but the register is C2's to allocate, not ours, and
emitting `i2d` differently does not change that the value has the wrong type.
Widening `limit` once outside the loop is wrong: `limit` is a `double` because
the program's arithmetic produced one.

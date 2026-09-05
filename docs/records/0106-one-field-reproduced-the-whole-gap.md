# 0106 — One field reproduced the whole gap

> **Refuted, then restored, and the middle correction was the wrong one.** The
> conversion is the cause. It is the **counter's**, at the comparison -- which
> is what this record's first version said -- not the accumulator's, which is
> what I corrected it to. Widening `yielded` upstream moved nothing because the
> counter swamps it. See the 2x2 at the end.


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

## Correction: the conversion is at the accumulator, not the comparison

The paragraph above says `i < limit` widens the counter. It does not. The
emitted code is:

    getfield upTo$frame.yielded:I
    i2d                              <- every element
    dload  total
    dadd

`yielded` is narrowed to `i32`; `total` is an f64 accumulator; each element
widens on the way in. `specialize.rs` names this and prices it -- *"Left apart,
the counter and its comparison become integers and only the accumulation pays a
conversion"* -- and the conversion lands on the accumulator's **loop-carried
chain**, which is the whole cost.

The identification stands: an `int` counter in the reference reproduces our
time to 0.2%, because it produces the same widening on the same chain. Only the
account of *where* was wrong.

A prototype that joined comparison operands across a parameter changed nothing,
because those operands were already joined -- the parameter exclusion never
fired on this program. It is removed rather than kept.

## And it is not a wrong decision, it is a backend-asymmetric one

`target/bench/generator.specialized.c` carries `int32_t yielded; double limit;`
and five `(double)` casts in the same places. The C lane makes the identical
choice:

    C lane      180.46 us against C++ 170.22   = 1.06x
    JVM lane    590 us against Java 172.5      = 3.43x

**The same conversion on the same chain costs 6% on one backend and 243% on the
other.** `cvtsi2sd` merges into its destination register, so a reused register
serialises the chain; clang breaks the dependency and C2 does not. No IR
expresses that, and no instruction count shows it -- 1.25x the instructions
against 3.41x the cycles.

So the pass is right by its own reasoning, and its reasoning names the compiler
it was reasoned against: *"which the C compiler hoists out of the loop"*. A
decision correct on the lane it was measured on, carried to a lane where the
same instruction is not the same cost.

The rule that would fix it is narrower than joining arithmetic operands, which
was tried and sank the counters: **a class whose every use requires a
conversion has nothing to gain from being narrow.** `yielded` is multiplied by
three and immediately widened; the integer multiply buys one instruction and
the widening costs a loop-carried dependency. `specialize.rs` already has the
mirror of that check -- "a class with no arithmetic in it has nothing to make
faster".

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

## Refuted, and the trap is worse than a wrong hypothesis

nts-69 built the rule this record asked for. The conversion left the emitted
bytecode -- `getfield upTo$frame.yielded:D` straight into `dadd`, no `i2d`,
confirmed by reading the class rather than by trusting the change. Their lane
was 1.06x before and after, as predicted. **This lane was 3.42x before and
3.42x after**, which was not. The change is reverted: it moved no number on
either backend and widened a frame field from four bytes to eight.

So `i2d` on the accumulator's loop-carried chain is not the 3.4x.

### Why this is worse than being wrong

Everything about the diagnosis looked confirmed. A mechanism (`vcvtsi2sd`
merging into its destination), an instruction visible in the disassembly, a
dependency chain that explains identical branch counts with triple the cycles,
and **a reference edited by one field that reproduced our time to 0.2%**.

That last one is the trap: *a reference that reproduces a number is not thereby
a reference that explains it.* `double i` → `int i` in the reference produced
588.8us against our 590.2us, and it did so by some route that removing the
conversion does not disturb. Two programs can agree on a number for different
reasons, and the closer the agreement the more convincing the coincidence.

### What is left to separate

- The reference's `int` counter is a **local**; ours is a **field on a heap
  frame**. If C2 scalar-replaces one and not the other, `int` versus `double`
  may be a proxy for whether the frame survives at all.
- `held0` is still an `i32` and still converted **at the comparison**. Only
  `yielded` was widened. That conversion is worth 30% on the C lane, so the
  counter is the remaining candidate and the one the first message named.
- The `int i` result may be confounded by something the reference changes
  alongside the type.

### What stands

The backend asymmetry is independent of the cause and remains measured: clang
emits `xorps` before every `cvtsi2sd` and C2 does not, so the same conversion
is 6% on one lane and expensive on the other. And `i2d` is a single bytecode --
which machine instruction it becomes, and whether its destination is broken
first, is C2's register allocation. **This lane cannot emit the fix even where
the conversion is the cost**, which is why the IR fix mattered here and not
there.

## The 2x2 that should have come first

Four corners of the reference, one variable each:

| | `double yielded` | `int yielded` |
| --- | ---: | ---: |
| **`double i`** | **172.5 us** | 255.5 us |
| **`int i`** | **588.7 us** | 589.6 us |
| nts (JVM) | | **590.1 us** |

**`int i` alone gives 588.7, within 0.3% of ours, whatever `yielded` is.**
`int yielded` alone is worth 1.48x. So the counter's conversion swamps the
accumulator's, and widening `yielded` upstream correctly moved nothing.

### The error, which is not the one the refutation named

`Ref6` changed `i` to `int` **and left `yielded` a double**. It reproduced our
number, and I read that as "the mixed-width pair is the cause" and then went
looking in the disassembly for where the pair converts. I found an `i2d` on the
accumulator path, reported it, and corrected a right answer into a wrong one.

Two variables moved in one experiment and I attributed the result to whichever
one I found first in the assembly. The fix is the 2x2 above, which costs four
runs instead of one and answers a question one run cannot.

nts-69 built and reverted a change on that wrong correction. Their revert was
right on its own evidence -- widening `yielded` moves nothing -- and their
conclusion that the conversion is not the cause was one step too far, for the
same reason my correction was: neither of us had separated the two fields.

Their *first* control measured `held0` wide against narrow and found 30% on the
C lane. I told them that was the wrong field. It was the right one.

### What stands

The mechanism, unchanged: `cvtsi2sd` merges into its destination register, so a
conversion on a loop-carried chain serialises it. The asymmetry, unchanged:
clang emits `xorps` before every one and C2 does not, which is 30% on that lane
against 3.4x on this one. And this lane cannot emit the fix -- `i2d` is one
bytecode and the register is C2's.

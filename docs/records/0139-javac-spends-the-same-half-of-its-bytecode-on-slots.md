# 0139 — javac spends the same half of its bytecode on slots

Record 0099 left a question open -- *2.9x javac's bytecode on `awfy-bounce`, C2
recovers half, residue unattributed. Attribute before choosing between slot
reuse by live range, fusing block-parameter copies, and the materialised
boolean* -- and the standing plan names slot traffic as the thing to cut:

> The emitter stores every SSA value to a slot and reloads it. [...] The JVM is
> a stack machine; HIR knows which values have one use in the next operation
> and never need a slot.

**Attributed on `awfy-nbody`, and the premise is wrong.**

    ours,   NBodySystem$advance   502 bytecodes   257 slot ops   51.2%
    javac's, NBodySystem.advance  180 bytecodes    87 slot ops   48.3%

javac spends **the same half** of its output moving values between slots and the
stack. Slot traffic is not this backend's anomaly; it is what compiling to a
stack machine with local variables looks like. What is anomalous is the total --
2.79x -- and the slot count scales with it rather than causing it.

So "eliminate the round trip for a value with one use in the next operation"
would move our 51.2% toward javac's 48.3% and no further, on a difference that
is 2.79x. It is the wrong lever and it was the first one on the list.

## What the 2.79x is actually worth, which is much less

The bytecode ratio is not the cost. With a fixed-count driver -- 30 warmup then
exactly 200 operations, because the ordinary harness is time-budgeted and record
0049 says instruction totals from it do not compare:

    nts (JVM)   8,647,069 ns/op   244,811,091 instructions/op   IPC 4.88
    Java        7,977,385 ns/op   195,038,006 instructions/op   IPC 4.21

**1.26x the instructions, recovered to 1.08x by 1.16x better IPC.** C2 removes
most of the 2.79x before it reaches the machine, which is what record 0099
suspected and did not measure.

The opcode mix says where the survivors are, and it is not slots:

    ours    118 dstore  78 dload  59 dconst  44 aload  37 lstore  29 getfield
    theirs   40 aload   33 invokevirtual  25 dload  19 dmul  8 iload

Two real differences. **They call accessors** -- 33 `invokevirtual` that C2
inlines at run time -- where we inline at compile time and emit the field access
directly; that is us trading bytecode for calls and it is not obviously worse.
And **61 of our slot operations are `lstore`/`lload` against none of theirs**:
our loop counters are `i64` where theirs are `int`. Same instruction count, two
slots instead of one.

`NtsRuntime.bounds` is 4.37% of the row, and the reference has no equivalent
because C2 eliminates an array bounds check in a counted loop. Ours is an
explicit call because the subscript is emitted `checked: true` -- the middle end
did not prove the range. That is the one attributable chunk with a named owner,
and it is upstream.

## What I would not do next

Slot reuse by live range, fusing block-parameter copies, and the materialised
boolean were the three candidates. The first is now measured as worth at most
three percentage points of a two-and-a-half-times difference. The other two are
unmeasured and I am not guessing again today -- this is the fifth hypothesis
this session that a number declined to support, and the pattern in every one is
that the profile or the bytecode named a *quantity* and I read it as a *cost*.

## The prologue half of the same claim, also measured

The plan pairs slot traffic with *"30% a definite-assignment prologue"*. Counted
across seven cases, as leading const-then-store runs before any real work:

    fib               101 bytecodes    4 prologue    7.9%
    generic-classes   266                 0          0.0%
    in-narrowing      435                 0          0.0%
    upcast            337                 0          0.0%
    instanceof        344                 0          0.0%
    module-closures   425                 0          0.0%
    symbol-keys       439                 0          0.0%

**Zero in six of seven.** The 30% was measured on `upTo__resume`, a generator
resume body, and generalised to the emitter. It does not generalise: a resume
function re-enters at an arbitrary block and so must definitely-assign every
slot it might reach, and an ordinary function does not.

`fib` is the one with any, and it is 1.04x with **IPC 2.85 against the
reference's 2.78** -- the same efficiency per instruction, four percent more
instructions, on a recursion whose critical path is the call chain. The store
and reload of `n - 1` before passing it are off that path, which is the rule
this record's first half establishes.

So both halves of that entry are now measured, and neither names a lever.

# The third kind of storage, and the half of it that mattered

A number lives in one of three places: a local, a field, or a global.
`hir::fields` says what a field can hold. `hir::elements` says what an array's
elements can hold. A module-scope variable had neither, so every read of one was
`TOP` — and a `TOP` in a loop makes every operation after it floating point,
whatever the slot actually contains.

`benches/cases/module-closures` was **4.83x hand-written C++ and 2.15x node**. It
is **1.03x and 0.44x** now. The pass is ninety lines and the interesting part is
that the first version of it bought almost nothing.

## Found by a benchmark that was measuring something else

The case was written for record 0085, to answer whether a closure held in a
module-scope `const` is as cheap as one held in a local. The row lost to node,
which the standing goal does not allow, and the explanation was ready: a local
closure lives in the frame where clang can see through it, a module-scope one is
a heap object behind a global pointer.

Wrong, and a probe said so in one run. Same arithmetic, same two module-scope
arrows, same globals, with `step` written as a `const` that folds rather than a
`let` that is storage — 2.51us against C++'s 2.55us. A second probe replaced
both arrows with **plain module-scope functions**, keeping the mutable global:
4.81x C++, as bad as the closures. So it was never the closures, and it was
never the globals as such. It was one mutable number.

Two probes, both taking three minutes, and between them they moved the cause
from "the feature I just built" to "a thing nobody had looked at". The
explanation that was ready would have gone into a record as a fact.

## The first fix was the wrong half

The obvious reading of `static double step` against C's `std::int32_t` is that
the *width* is wrong. So the first version of `hir::globals` narrowed the
storage: join every store, and if they all fit in an `int32`, make the slot one.
It works, `static int32_t step` appears in the output, and it is worth:

    before  17.84us      after  16.05us      C++  2.30us

Ten percent, on a 7x gap. The width was not what the arithmetic was waiting on.

The arithmetic was waiting on **facts**. `hir::flow` consults `field_facts` for
a `FieldGet` and had no arm at all for a `GlobalGet`, so a global read returned
`TOP` — not because the slot was wide, but because nothing had ever computed
what it holds. With `TOP` in hand, `(x ^ y) + step` might be a fraction, might be
NaN, so the `| 0` after it is a call and everything upstream of it is a double.

Giving `GlobalGet` the same treatment `FieldGet` already had:

    17.84us  ->  2.42us          4.83x C++  ->  1.03x
                                 2.15x node ->  0.44x

The width narrowing stayed, because it is right and it halves the slot. But it
is the consequence, not the cause, and the module's doc comment now says so in
that order.

## What it is, in the same fixpoint as everything else

`globals::analyze` joins every `GlobalSet` value with the declaration's starting
value, and it lives inside `interprocedural`'s Kleene iteration beside
`fields`, `elements`, `returns` and `slot_returns` — because a global is written
with what a call produced and read to make the next call's argument, and outside
the loop it would be one round stale.

Soundness is the one-line argument fields already use: nothing else can write a
global. There is no FFI writing through a pointer here, and every store the
program makes is a `GlobalSet` in the HIR, so the join over them
over-approximates what any read can see. `Global::initial` is joined in because
a read can happen before `module#init` runs — which is not hypothetical, it is
the entire subject of `examples/module-cycle`.

## The refusals, and the one that was testing air

An integer slot cannot hold a fraction, a NaN, an infinity, a value past 2^31,
or a value past 2^53 where a double stops telling adjacent integers apart. And
it cannot hold `-0`, which is the sharpest of the six: `-0 === 0` is true, so
equality cannot see the difference, and `1 / -0` is `-Infinity`, so division
can. `examples/module-numbers` has a case for each and node agrees on all 319.

**The negative-zero case did not test the negative-zero rule.** It was written
as `signedZero = n * 0`, which is `NaN` when `n` is an infinity — so the
analysis refused it for being possibly-NaN and never reached the `-0` question.
Deleting the `maybe_negative_zero` check entirely changed nothing, and the
mutation pass is the only reason I know: four of five mutations failed the right
test and the fifth failed nothing at all.

Rewritten as `signedZero = n < 0 ? -0 : 0`, the same mutation narrows it to an
`int32` and the test fails. A check that cannot fail is not one, and a *fixture*
that cannot exercise a check is the same problem one level out — which is the
gap the JVM session named this morning from the other end: a test whose inputs
never leave the easy part of the domain.

## A dead field, found by writing a test for it

`hir::globals` declines to narrow a global whose `exported` flag is set, because
a reader outside the compiled set would hold the declared type. The test for
that guard failed: `export let visible = 0` narrowed anyway.

`Global::exported` is **never set**. Both construction sites in `hir::lower`
write `exported: false` and nothing later assigns it. Three backends branch on
it — C picks `static`, LLVM picks `internal`, the JVM picks `PRIVATE` — and all
three branches have gone one way since they were written.

Narrowing `visible` is correct for how this compiler builds: the whole module set
is one program and every export resolves inside it. So the guard is inert rather
than wrong, and the test now asserts the *flag* instead of the width, so that the
day a global gets an external reader it fails and points at the guard already
waiting. That is the fourth thing this week that was written down as an
intention and read as a fact.

## What is left on the table

`counter` in `examples/module-numbers` does not narrow. It is a loop
accumulator stored once after the loop, bounded by construction at about
125,000, and the analysis loses the bound crossing the loop. Not a soundness
question — a missed one, and the sort a later `loops` sharpening would collect
along with everything else.

`swing` does not narrow either, and that one is correct: `-(n | 0)` for
`n = -2147483648` is 2147483648, which is one past what an `int32` holds. The
example keeps it as the case that looks narrowable and is not.

## What the example found that had nothing to do with globals

`examples/module-numbers` compiled through C and agreed with node on all 319
cases. Through the LLVM backend it produced **no module at all**:

    not rendered: NTS3001 the operator BitOr on this representation (in `keepsNaN`)
    not rendered: NTS3001 the operator BitOr on this representation (in `keepsInfinity`)

`n | 0` is an integer operation and the representation around it is not always
an integer. `n === 0 ? 0 / 0 : n | 0` joins a NaN with an int32, so the join is
a double and the `|` arrives with `Float` operands. The C backend has spelled
that since it was written — `(double)((int32_t)a | (int32_t)b)` — and the LLVM
backend had no arm for it, so `binary()` fell through to its catch-all and
declined the function.

The fix mirrors C: `fptosi`, the integer operator, `sitofp`. `fptosi` is exact
here for the same reason C's cast is — JavaScript's `|` applies ToInt32 to both
operands first, so what reaches this is already an integral value that was
*widened* to a double, and the narrowing undoes the widening rather than
converting anything.

**And the way it was nearly missed is the more useful half.** The gate went
**green** on the run that contained it:

    llvm     89 of 90 examples agree with node
    llvm-rc  89 of 90 examples agree with node

The floor is 89. Scoring exactly the floor is a pass, so the step reported
success while a new example did not agree on a backend. The only reason I know
which one is that the JVM session had, an hour earlier, changed
`backend_examples` to print the failing names *whenever the list is non-empty*
rather than only when the floor is breached — which they did in response to me
hitting the same silence from the other side.

That generalises past this gate: **a threshold check publishes a boolean and
discards the evidence, and the evidence is what you need on the run where the
boolean is fine.** Sitting exactly on a floor is the worst case, because it is
the only one where something changed and the output is indistinguishable from
nothing having changed.

## Ratchets

- `examples/module-numbers` — 319 cases against node, eleven exported functions,
  six of them the values an integer slot cannot hold.
- `compiler/core/tests/global_widths.rs` — five tests, five mutations, each
  failing a different one. The one that pins the flow arm is separate on purpose:
  a test on the width alone passes with the expensive half deleted.
- `tooling/memory/cases/module-counter` — 0 / 0, argued before measuring. The
  zero is the claim that a module-scope number stays a number rather than
  becoming a box.
- `benches/cases/module-closures` — 1.03x C++, 0.44x node.
- `compiler/codegen/llvm/tests/agrees_with_c.rs` — the two backends agree about
  bitwise operators on doubles, over thirteen arguments including both zeros,
  both infinities, NaN, and both ends of the int32 range. Removing the arm names
  all three operators.

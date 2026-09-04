# The operator that is not a compound assignment, and four references that flattered nts

`??=`, `||=` and `&&=` lower. The feature is the smaller half of this record.
The larger half is that while measuring it I found a defect in the benchmark
references I wrote earlier in the week, and three published numbers were
measured against a C++ that was doing work nts was not.

## The operator

Nothing new in the IR. A logical assignment is a branch whose taken arm
performs a store, which is three pieces the lowering already had -- `place_of`,
`lower_branching_value`, and the absence and truthiness tests `??` and `||`
already ask -- and one new `Branch` variant to put the store *inside* the arm.

That placement is the whole design. `a ||= b` is not `a = a || b`, and the
difference is not an optimization of it:

- the right operand is evaluated only on the writing path, so `a ||= f()` does
  not call `f` when `a` is truthy;
- and **no store happens at all** on the other path, which is observable
  through a setter that does not run and through the release a counted store
  performs on the value the place was already holding.

The target is lowered once, before the test, so `xs[next()] ??= 1` calls `next`
a single time however the test goes. `place_of` existed for `+=` and needed
nothing added.

`??=` and `||=` ask different questions and one is not a narrowing of the
other. `n ||= 1` overwrites a present `0`; `n ??= 1` does not. The unit test
asserts on the *shape of the test emitted* -- a `TagOf` and two tag comparisons
against a `Truthy` -- rather than on an answer, because the answers only diverge
on falsy inputs and a lowering that asked the wrong question passes every
arithmetic case.

The arm that keeps the value is a `Present` for `||=` and `??=` and a `Value`
for `&&=`. Truthy excludes both absences and so does the nullish test, so those
two may read an erased value back at the type the whole expression has; `&&=`
keeps its value where it is *falsy*, and `undefined` is falsy. Getting that
backwards unerases a payload that is not there.

## Three things that were nearly wrong

**`assigned_symbols` had to learn it.** The collector that gives a loop header a
parameter for every name its body writes tests for `=` and for the compound
tokens. A conditional write is still a write, and its own comment says what
missing one costs: not a wrong answer, but a header with no parameter, a body
reading its entry value, and a back edge that never passes the update. Removing
that one clause makes `orInALoop`'s header carry one value instead of two, and
the test for it fails.

**The accessor refusal named a construct the source did not contain.** Reading a
place before writing it is refused through an accessor, and the message said "a
compound assignment through an accessor" -- while refusing `??=` too. Renamed to
"an assignment that reads through an accessor", which is what it is. A refusal
that sends the reader looking for a `+=` that is not there is worse than the
gap it reports.

**The `erasure` measurement had an arm for `&&` and none for `&&=`.** It is a
measurement and not a representation, so the cost was a wrong number in a table
rather than a miscompile -- but the right operand of a logical assignment lands
in the target exactly as `=`'s does, and it was being counted as an ordinary
operand. Merging it into the `=` arm made clippy point out they were the same
rule written twice, which they were.

## The memory case, argued three times

The floor is supposed to be argued before measuring. It was, twice, and both
were wrong -- which is the case for writing it down first rather than an
argument against it.

**First: a `??=` filling an optional field, argued at zero and zero.** Measured
one allocation and two operations. The short-circuit worked exactly as claimed
-- one allocation across `8 + n` iterations, not `8 + n` -- but the argument had
forgotten that an object born inside a loop cannot live in a frame slot, because
"at most one is ever made" is a property of the branch and not of the loop.
`store-elsewhere` has known that since it was written.

**Second: the same shape with a string field, argued at one operation.** The
suite refused it: *0 allocations cannot need 1 operations*. That check is right,
and it is right about something I had reasoned past. The one release was of a
slot holding a string literal, which is immortal; if nothing was allocated then
nothing needs giving back, and a case that claims otherwise is describing a
compiler that has not finished rather than a floor.

**Third, and the one that is in:** the target is a number, so nothing is counted
anywhere, and the right operand is a concatenation inside a loop that runs
`8 + n` times and is never built. Allocations zero against `8 + n` for the
desugaring. The bound is `8 + n` rather than a literal so the compiler cannot
fold the truthiness and delete the arm -- a case where both spellings fold
proves nothing about either.

The ratchet has teeth on the column that matters: if the short-circuit ever
breaks, allocations read `8 + n` against a floor of zero.

## What I did not fix

On the arm where `??=` writes, the emitted store releases the field's previous
value -- and that arm is entered *precisely because the test proved the field
null*. It is a load, a call and a branch to release a null, once per write.

`rc.rs` already has the concept: a store `initializes` when the slot was still
zero, and then it owes no load and no release. What it does not have is this
source of the fact. `Fresh` tracks slots whose construction it saw, and a loop
back edge ends that; what is needed is "this slot was proved zero by a test that
dominates this store", which is a dataflow addition rather than a tweak. It is
also not specific to `??=` -- `if (o.x === null) o.x = v` is the same shape, and
so is every guarded initialisation anyone writes.

Named here rather than folded into this commit.

## Four references that were not measuring what they claimed

This is the part worth reading, and the heading it replaces said "flattered
nts", which turned out to be wrong in a way worth keeping the record of.

`benches/cases/*/ref.cpp` keeps its input opaque so clang cannot fold the
answer. Thirty-five cases do this at the **call site** -- `volatile
std::int64_t n = 1000; return accumulate(n);` -- which is the structure
`nts.cpp` has, and the loop then runs with the bound in a register. The four
cases I wrote this week put the `volatile` in the **loop condition** instead,
where it is reloaded from memory every iteration. All four are one file copied
forward three times, and the suite's own convention was in front of me in
thirty-five others.

I found it because `logical-assignment` first measured at **0.52x** -- twice as
fast as the ceiling -- which is a number to disbelieve before publishing it.

**The first hypothesis was that the in-loop `volatile` handicaps the reference,
and it is wrong.** The check was to hoist the bound and re-measure, and the
controlled version of that -- old and new references, same filtered run, two to
three passes each, all stable inside 1% -- says this:

| case | C++ with in-loop `volatile` | C++ with the bound in a register | ratio before | ratio after |
| --- | --- | --- | --- | --- |
| `exceptions` | 20.09 us | 21.2 us | 1.67x | **1.58x** |
| `instanceof` | 58.0 us | 69.6 us | 0.77x | **0.64x** |
| `optional-chain` | 20.58 us | 9.4 us | 4.06x | **9.0x** |

Two got *slower* and one got twice as fast. A handicap does not do that. What
the in-loop `volatile` actually does is change what clang is allowed to do to
the loop, and whether that helps or hurts depends on the kernel -- it blocks
unrolling and vectorisation, which costs `optional-chain` a factor of two and
apparently saves `exceptions` and `instanceof` something.

So the reason to make the change is not that one shape is faster. It is that
**`nts.cpp` and `ref.cpp` have to be built the same way or the ratio is not a
comparison**. The nts side has always taken its bound as a parameter, because
the generated function must. A reference that does not is measuring a different
harness, and which direction that moves the number is exactly the thing you
cannot know without checking -- as these three demonstrate, in both directions,
from one cause.

`optional-chain` is the one that matters: it was published at 4.06x and is
**9.0x**. That row is my own from two days ago and the number was wrong by more
than a factor of two.

## The benchmark that was not one

Correcting `logical-assignment`'s reference made it read **1.3 ns**. With the
bound in a register and a kernel whose answer is an affine function of the
iteration count, LLVM's scalar evolution solves the loop in closed form and
emits arithmetic. The in-loop `volatile` had been hiding that, which is the
second thing it does that has nothing to do with fairness.

A reference the compiler can evaluate is not a ceiling, it is a division. The
kernel is now a multiply-add recurrence whose low two bits decide the test, so
neither side can close it, and both must run the loop. Choosing it also walked
into an LLVM backend gap -- `BitAnd` declined on a value the specializer had
left as a double -- which is why the row printed no LLVM column until the
kernel established its int32 the way `accumulate` does.

## Numbers

| case | before | after |
| --- | --- | --- |
| `exceptions` | 1.67x | 1.58x |
| `instanceof` | 0.77x | 0.64x |
| `optional-chain` | 4.06x | 9.0x |
| `logical-assignment` | -- | **1.02x** |

`logical-assignment` is at parity with the C++ ceiling: 49.56 us against
50.78 us through LLVM. Against the runtimes it is 0.15x node and 0.75x bun --
6.8x faster than node, and faster than bun, on a kernel bun is otherwise good
at. The remaining 2% is the branch and the conditional store, which is what the
reference spends too.

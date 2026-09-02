# 0025 — The allocator was not the cost

This began from a table and a claim: reference counting was nearly done, what
was left was allocation, and `awfy-towers` at 6.79x C++ was the worst row in the
suite because it allocated.

`awfy-towers` allocates **fourteen objects**. It is 1.28x now, and every one of
the five and a half times it improved was counting.

    awfy-towers   6.79x -> 1.28x C++   (2.64x -> 0.51x node)
    awfy-bounce   4.13x -> 1.39x C++   (1.34x -> 0.47x node)

Both were predicted to need work neither of them needed, and both are worth
recording as diagnoses that survived a long time without being contradicted.

## The instrument had to change first

Fourteen of fifteen `tooling/memory` cases were at their reference-counting
floor. A suite at its floor is a regression test: it can tell you when something
breaks and it cannot tell you what to do next.

So `tooling/memory` counts allocations too, against a floor argued in `expected`
beside the counting one. The floors were written before the first measurement --
the only way a prediction is worth anything -- following one rule: an allocation
is necessary when an object's lifetime is not bounded by a scope with a
statically known count. A list built in a loop needs a heap. Everything else
belongs in the frame.

None came in below its floor, so no argument was too generous, and 122
allocations were above one. Every one was an object dying with the iteration
that made it.

Two rules moved 103 of them, and both are about the difference between reaching
a value and writing through it.

**A per-iteration container may hold a per-iteration value.** `escape` refused to
confine anything made in a loop and stored, because a frame allocation is one
slot and `balls[i] = new Ball(...)` would put a hundred objects through it --
which it once did, computing 1117 where node computes 1331. But that needs the
*container* made once and the value made many times. A fresh closure holding a
fresh cell is two slots reused in lockstep.

**Being stored somewhere is not being written through.** Storing `x` into `y.f`
lets somebody *reach* `x`; it does not let anybody write through it. What has to
be ruled out is a store *aimed at* the slot, and a store is aimed by naming
something -- so if every `FieldSet` names an allocation or a parameter directly,
the writes recorded are all the writes there are.

That distinction is the same one the freshness dataflow drew from the other
side a week earlier: *a store does not end a value's freshness; a load does*.
Reaching and writing are different powers, and conflating them has now cost in
both directions.

## Then the counting that no single block could see

With the allocations gone, the rows still did not move, and the reason was that
the diagnosis was wrong. `awfy-towers` allocates fourteen disks and then moves
them 8191 times. What it spent was counting -- on **array elements**, across
calls and branches.

Four facts, each measured:

- **An element slot can be named through a value.** `slots[at]` with `at` a
  parameter could never be taken out of, because a slot was named by a
  *constant* index. Two reads with the same `at` are the same slot; SSA says so.
- **A take can cross the branch that asked whether the value was there.** A take
  says the slot has given up what it held; if the store does not happen on some
  path, the slot and the value both claim the reference. Unless the value is
  null there -- and a nullable reference in TypeScript is *tested* before it is
  used, so the arm where the test says no is exactly where the compiler already
  knows it is absent.
- **A pending take survives a join.** `pushDisk` reads the slot, tests two
  things about what it found, and stores in the block where both arms come back
  together. Null-ness has to travel for that, and the throwing arm needs no
  account at all: `nts_thrown` calls `abort`, so nothing after it is observed.
- **A function that keeps what it is given should be handed it, not lent it.** A
  parameter is borrowed, so a store needs a reference of its own, so the callee
  retained and the caller released a moment later.

And one interprocedural fact, which was priced before it was built:

- **A field every caller has already zeroed.** A store into `p.f` gives back
  what `p.f` was holding, and a parameter is opaque -- so linking a freshly
  detached node into a list pays a load and a release of a null on every call.
  An unsound control (assume every parameter's field is zero) put the row at
  2.36x against 3.05x, which is what justified building it.

## The leak nothing else could have found

`x.f = null` never gave back what the field was holding. Every program, under
naive counting as well as elided, since long before any of this.

The store branch was guarded on whether the value being stored needs counting,
and a constant null does not -- rightly, since storing one takes no reference.
But the guard sat on the *whole* branch, so a store of null skipped the load and
release of what the slot already held. The question belongs to the slot.

`popDiskFrom` ends `top.next = null`, so `awfy-towers` leaked a disk on every one
of its 8191 moves, and the 6.79x this record opens with was measured on a program
losing memory as it ran.

Nothing caught it, and it is worth being exact about what "nothing" covers. 91
examples agree with node: the answers were never wrong, because a leaked list
computes the same sum. `rc` checks live counts across those examples and no
example nulls a field and then looks. ASan reports use-after-free, which this is
not. It was found by a case written to model the worst benchmark row, running in
twenty seconds, reading a live count before and after.

## Elision and cycle collection are in tension

Making callers hand ownership to callees broke cycle collection, and the symptom
was not a dangling pointer but a *silence*.

`Node#constructor` is `this.next = this`, so `this` is a parameter stored on
every path and the rule said the caller should hand it over. It did, while still
reading `node.next` on the next line. The object's only remaining reference
became the one inside itself -- so no count ever fell, no candidate was ever
buffered, and a hundred self-cycles a run leaked with no wrong answer anywhere.

**A cycle is discovered by a decrement that does not reach zero.** Elision, taken
far enough, removes the decrement. That is not an argument against elision, but
it is a thing the collector's correctness now depends on, and the `execute`
suite's cycle test is what holds the line.

The immediate bug was narrower: `dies_in` says a value's last read is somewhere
in this *block*, not that it is *here*. A store can lean on that, because it
claims the death and nothing after it reads what was stored. A call in the
middle of a block cannot.

## `escape.rs` cannot read `own`, and this is why

The goal that produced this record asked for it, on the argument that `escape`
had the block-parameter blind spot `crossing_borrows` had -- which its own
comment said, and which was true.

It cannot, and the reason is an ordering. `own::owned` asks whether an
allocation lives in the frame, which is `escape`'s answer, applied by
`place_allocations` before `rc::insert` runs. `own` depends on `escape`; the
dependency cannot go both ways.

What was actually wrong is fixed, on both sides separately: a value handed to a
block parameter has not gone anywhere, and escapes exactly when that parameter
does. What looked like duplication turned out not to be -- `escape` wants which
parameter *slots* a function returns, and `own` wants whether *every* counted
return is a parameter. Same neighbourhood, different questions, and forcing them
together would weaken one.

## What is left

`early-return` is the last case above its floor: seventeen operations and
seventeen allocations, for a box allocated inside `maybe` and returned. It
escapes that function, and reaching the floor needs the *caller's* frame to host
it -- either by inlining, which this compiler has no pass for, or by
caller-placed storage, which `OpKind::Call`'s `storage` field already does for
strings and would need an ABI change to do for objects.

The floor stands at zero because both are real techniques and the object's
lifetime genuinely fits in the caller's frame. It is not reachable today, and
saying so is more useful than moving the floor to meet the compiler.

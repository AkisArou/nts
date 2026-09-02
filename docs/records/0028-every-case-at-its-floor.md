# 0028 — Every case at its floor

Twenty of twenty, on both columns. This is what the last two took, and one of
them contradicts the record before it.

## `readonly-anchor`: five above, and three of them were arithmetic

The floor said 38 and the measurement said 43. Taking the difference apart was
worth more than closing it.

**One was an operation nothing was counting.** `module#init` ran `kept = null`
over a global the static initializer had already set to null, and released what
it found. The harness calls the initializer *before* `nts_counting_reset`, so
that release was never on the bill -- and it is now not emitted either, because
the module initializer is the one function that runs before anything has had a
chance to write a global.

**One was a cost I had not thought of.** Destroying an object walks its
reference fields, and every one of those releases is counted. The `Config` held
the label in two slots, so freeing it was two more operations. That is right:
it is the program's own work, and the harness is careful to separate it from
the *collector's*, which it reads the counters before running.

**One was a limit that turned out not to be one.** `consuming` accepted a
parameter stored *once* and no more, so a constructor putting its argument in
two slots retained twice and the caller released after. The arithmetic never
needed that. The callee needs one reference per slot, is handed one, and owes
itself the rest -- and `rc` already emits exactly that, because at most one
store per value may claim the value's death. All that was required was letting
`consuming` see more than one store, in one block that dominates every return,
so that they cannot disagree about whether they ran.

    readonly-anchor   43 -> 40 operations, at its floor

## `early-return`: the merge `0027` said not to build

`0027` measured a general inliner and deleted it: copying every small body made
the analysis worse, because the facts here are whole-function and
all-or-nothing. That record stands. This is the case it does not cover.

An object a callee makes and hands back cannot reach the caller's frame while
the two are separate functions, because placement is per function and the
allocation is in the wrong one. No summary can say otherwise. So `hir::inline`
copies a body for exactly that reason and no other: the trigger is not size, it
is that the callee **returns something it allocated**.

The line it must not cross is the defect `0027` found. A frame object's
reference fields are released where the *value's* live range ends, so handing
that pointer to a block parameter loses the walk -- which is how merging a
`chain` leaked thirty-two links. An object with **no reference fields** has no
such walk to lose. That is a `Box`, a `Point`, a result record, which is what a
factory in a loop hands back, and it is not a list node. The restriction is the
defect, written down, and widening it needs the duty attached to the frame
rather than to the value.

## Two things that had to be sharpened before it paid

**`escape` was testing repetition where it meant liveness.** An allocation made
in a loop and handed to a block parameter escaped, on the grounds of "one slot,
two live results". Most of them are handed *forward* within the iteration that
made them -- a factory's result arrives at the continuation the call became,
and that parameter is dead before the loop comes round. It is two live results
only when the parameter is still live where the allocation happens.

Following the parameter onward is not optional, and finding that out cost a
hang. A loop carries a value through the latch's parameter into the header's,
and the latch's is dead the instant it is handed on. Asking only about the
parameter the edge names said "not live" for `sumChain`, put a list node in one
frame slot, and made every link point at itself. The walk that followed never
returned, and the test suite went from twelve seconds to more than four minutes
before anyone noticed it was not slow but stuck.

**`counted` could not see through a block parameter.** With the `Box` in the
frame, `early-return` still paid one operation per iteration: a release of the
parameter where the factory's two paths meet, holding either a null or an
object in this frame. `counted` already answers "no" to both of those and
"yes" to the parameter, because a parameter fell through to the default. It now
asks what can arrive on it.

    early-return   17 allocations -> 0, 17 operations -> 0

Its naive column is zero too. There is nothing counted left in the program.

## What moved, and what had to move with it

The control in `without_reference_counting_the_same_program_leaks` failed,
which is the second time that test has had to change and the first time it was
recorded properly. It asserts that NoGC holds every object a program allocates,
and it needs a program that allocates. `run` stopped qualifying when escape
analysis reached it; `borrowChain` stopped qualifying here, because the
`makeCounter` it gets its object from is now merged into it.

It is `makeCounter` itself now, called from the harness. Its result goes to a
caller outside the program, so no analysis can put that object in a frame
without being wrong. A control should be made of something that cannot erode.

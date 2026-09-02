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

## And again, nothing on the benchmarks

`0027` said the same about the change before this one, and the reason is the
same. Measured under `NTS_BENCH_RC=1`: `awfy-bounce` 1.39x -> 1.38x C++,
`awfy-towers` 1.28x -> 1.30x, `awfy-list` 1.66x -> 1.67x. Every absolute time in
the run came out about five percent slower than the last one, `loop` included at
653 -> 698 ns for a body that does nothing but count, so the machine had drifted
and the ratios are what survived. Nothing moved.

The suite has no factory in a loop. Its object graphs are lists, piles and
trees, built to outlive the loop that built them, and a callee's allocation that
reaches the caller's frame is the case where the object dies with the iteration.
The table it would show up in does not exist yet. The README keeps the earlier
run, which was measured on a quieter machine and says the same thing.

## `escape.rs` reads `own`: the whole refusal, and how a false premise got in

`0025` refused this in a paragraph, on one argument. It is a standing item in
the goal that produced these records, so here is all of it.

**The dependency inverts.** `own::counted` answers "no" for
`ObjectNew { frame: true }` with no reference fields, and that flag is set by
`place_allocations` out of `escape`'s own answer. Everything in `own` that
decides ownership reaches `counted`. So `own` is downstream of `escape` by
construction, and the edge asked for would close a cycle rather than add
information.

**Anchoring answers a different question.** The reason given was "nothing should
escape that `own` can anchor". Anchored means the *place* a borrow was read from
stays alive for the rest of this frame -- a parameter, an entry-block local held
to every exit, a slot of something anchored. Escape asks whether an object
outlives the frame. A parameter is the clearest anchor there is, and the object
behind it certainly outlives this frame, because the caller made it. The two
predicates do not constrain each other in either direction, so reading one to
decide the other would be wrong even if the dependency allowed it.

**And the blind spot it was named for was already closed.** The goal said
`escape` "has the block-parameter blind spot `crossing_borrows` had -- its own
comment says so". `hand_on` had stopped marking every edge argument as escaped
some time before, and its doc says exactly that. What was left was the other
half, and it is now closed too: an allocation made in a loop and handed on
escapes only where the parameter receiving it is still live where the allocation
happens, following that parameter onward through the latch.

The evidence that nothing is left on the table is the column this goal added:
twenty of twenty cases at their **allocation** floor, each floor argued in
`expected` before it was measured.

The premise survived into a goal because the module's own header still said
`- passed along an edge, because a block parameter is a value this analysis does
not follow`, three hundred lines above a function whose doc says it stopped
doing that and what it cost. A stale comment is not a small thing when a comment
is what the next reader plans from. It now says what the code does.

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

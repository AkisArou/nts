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

**And the strongest form left is worth zero, measured.** The arguments above
are about the edge the goal named. There is one place `escape` could read a fact
`own` holds without any cycle at all: every argument to an **external** call
escapes, unconditionally, and `own::consumes` is a static table of what the
runtime helpers do with what they are handed -- written down, not derived from
`escape`.

So the ceiling was measured rather than argued. Removing the blanket entirely --
unsound, as a probe -- moves exactly one case:

    array-of-objects   18 allocations -> 1, BELOW allocation floor

That is `nts_array_push_ref`, the one helper that genuinely stores its argument
and the one entry `own::consumes` already has. Every other case is unchanged,
because no other one hands an object to a helper in a position a frame could
hold. A sound version of this edge would therefore buy nothing: the blanket
costs nothing anywhere except where it is load-bearing, and there it is right.

The probe is also the check checking itself. An unsound placement showed up
immediately as `BELOW allocation floor -- the argument in expected is wrong`,
which is the column existing to say so.

The premise survived into a goal because the module's own header still said
`- passed along an edge, because a block parameter is a value this analysis does
not follow`, three hundred lines above a function whose doc says it stopped
doing that and what it cost. A stale comment is not a small thing when a comment
is what the next reader plans from. It now says what the code does.

## And the corpus count is the wrong ratchet, with a number

The goal this record belongs to ends "then close `typescript.md`: 48 of 184
corpus cases still refuse". Closing the `for...of` row was the first test of
that ratchet and it failed in a way worth writing down: the row went 3 to 0, was
verified against node over 493 cases, and **no case flipped**. All three reached
their next refusal instead.

That is not particular to `for...of`:

    99 refusal sites, 52 distinct messages, across 48 refusing cases -- 2.1 each

So the tallest row, `console.log` at 7 sites, would complete approximately no
cases: it removes 7 of 99, and each of those cases carries another blocker
behind it. And 52 distinct messages over 48 cases is a flat tail, not a queue.

The corpus is TypeScript's own test suite, written to stress the *checker*. Its
cases stress it deliberately: the rest-parameter row is `...args: any[]` inside
a generic mixin whose point is declaration emit, and the `console.log` row
includes a regression test for `asserts condition` predicates. In each the named
refusal is the first one hit, not what the case needs.

`typescript.md` §15 already says the better queue is beside it -- the node
profile's 1,097 sites, "the only list ordered by what real code actually needs
rather than by what looks incomplete" -- and says to name what a row blocks on
before building it. Naming them, from the refusals as they stand:

| row | what it actually blocks on |
|---|---|
| rest parameter (4) | nothing about rest parameters: they lower today as an ordinary array parameter, and every refusal is `...args: any[]` or a generic constrained to `unknown[]`. It is `any` and instantiation |
| `console.log` (7) | `any[]` rest, a value formatter, and a way to check it -- the differential compares returned values by bit pattern, so printing is outside what the oracle sees |
| `Date` property (4+2) | a `Date` representation |
| tagged template (4) | the strings array object, which is the first thing here that wants an allocation with identity across calls |
| `for...in` (3) | key enumeration. For a sealed layout the keys are a static list, and the body's `obj[k]` is the real gap: a field read by a name known only at run time |
| a method on an object literal (3) | `this` on a literal, which is a binding rule rather than a lowering |
| `enum`, `namespace` with code (10) | **no oracle.** Node strips types rather than transforming them and refuses to run the file at all. §15 says build these last, and it is right |

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

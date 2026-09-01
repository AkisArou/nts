# 0024 — One ownership answer per value

Reference counting is not one question. It is asked three times in `hir::rc`,
once more in `escape.rs`, and each asking gets its own approximation. This
records what the four approximations disagree about, why the disagreements are
exactly where the counting survives, and what a single answer would have to look
like to replace them.

Nothing here is built. It is written down first because the last four analyses
in this area were each locally right and jointly incoherent, and that is a thing
a record can catch and a patch cannot.

## The measurement this rests on

`tooling/memory` counts the retain and release operations a case executes, three
ways: what a correctness-first lowering emits, what this compiler emits, and
what a person can justify as necessary written down beside the argument for it.

| case | naive | actual | ideal | eliminated |
| --- | --- | --- | --- | --- |
| `array-of-objects` | 86 | 52 | 18 | 39% |
| `borrowed-call` | 167 | 99 | 33 | 40% |
| `closure-capture` | 51 | 17 | 17 | 66% — at ideal |
| `cycle` | 54 | 36 | 18 | 33% |
| `early-return` | 23 | 23 | 17 | **0%** |
| `erased-slot` | 68 | 68 | 17 | **0%** |
| `global-array` | 34 | 0 | 0 | 100% — at ideal |
| `local-anchor` | 85 | 51 | 17 | 40% |
| `loop-break` | 69 | 51 | 17 | 26% |
| `param-returned` | 68 | 68 | 34 | **0%** |
| `shared-tail` | 131 | 57 | 21 | 56% |
| `store-elsewhere` | 168 | 66 | 33 | 60% |
| `subclass-field` | 85 | 85 | 53 | **0%** |
| `swap` | 104 | 2 | 2 | 98% — at ideal |
| `traversal` | 167 | 99 | 33 | 40% |

Lobster reports eliminating about 95% of reference operations. Two cases are at
ideal, the best of the rest is 56%, and seven are at zero for at least four
different reasons. That is the whole motivation: the gap is not one missing
rule, and adding a sixth predicate beside the five that exist is how it got
here.

## What the four analyses actually have in common

- `borrows_safely` asks, of a load: can this result be used without a retain?
- `crossing_borrows` asks, of a value: is it borrowed at every point it is live?
- `survives_the_function` asks, of a container: does it outlive the frame?
- `escape.rs` asks, of an allocation: does it outlive the frame?

The last two are the same question with different answers available, and the
first two are the same question at different granularities. Every one of them is
a partial evaluation of: **for this value, who holds the reference that keeps it
alive, and for how long?**

Four approximations of one fact, each free to be wrong in its own direction. The
strongest evidence that this is the real structure is that two of them fail at
the identical place, and `escape.rs` says so in a comment:

> passed along an edge, because a block parameter is a value this analysis does
> not follow

`crossing_borrows` gives up at the same edge, for the same reason, and it was
written separately. When two analyses that never met surrender at the same
construct, the construct is the problem.

## The IR does not say what an edge does to a reference

HIR is SSA with block parameters. `br b1(x)` and `b1(p)` make `p` a value that
is not `x`, and nothing in the IR says whether the branch handed over a
reference or lent one. Both analyses then try to *recover* that by dataflow, and
both stop.

**The first proposal is that the edge should spell it.** An edge argument is a
transfer, and a transfer has a mode:

```
br b1(move x)      the reference goes with it; x is dead after
br b1(borrow x)    the reference stays; p is valid while x's anchor is
```

This is not an optimization. It is the missing half of what block parameters
mean. With it, identity across an edge is read, not inferred, and the analysis
that currently fails at the join has nothing left to fail at. Without it, every
future pass that cares about lifetimes will write a fourth fixpoint over the
same edges and get its own subset of the answer.

The cost is real and should be stated: every pass that builds or rewrites blocks
has to say which mode it means. `simplify` and `specialize` rewrite edges today
and would have to. That is the price of the fact being in the IR instead of in
five places that each rediscover it.

### It is not the precondition this section implied

Written as the first thing to build, and it should not be. Flipping the fixpoint
direction below — thirty lines in one function, no IR change at all — took
`borrowed-call` from 0% to 40%, which is everything that was claimed for
following a value across an edge in a loop. A change that touches thirty six
construction sites and is proved by *no number moving* has to come after the
one that moves numbers, not before it.

What is still owed to an edge is narrower than "identity": it is that a value
handed to a block parameter and never named again has its reference **move**
there. `local-anchor` is that, and it is the next section.

## The lattice, and the two relations under it

For each SSA value of managed type, one of:

- **`Owned`** — holds a reference, and must give it back exactly once on every
  path from its definition.
- **`Borrowed(anchor)`** — holds no reference; valid exactly while `anchor` is.
- **`Unowned`** — needs no counting at all: constants, `ClosureStatic`, null and
  undefined, values in the frame, anything immortal.

`counted()` already computes a rough `Unowned`. The other two are what the
predicates approximate.

The important structural point is that **two different relations are being
conflated today, and they need different machinery**:

- **Identity** — "these values denote the same object". Created by edges, by
  moves, by casts that do not change representation. This is an equivalence
  relation, so it wants union-find, and with edge modes spelled it is built by
  one linear pass rather than a fixpoint.
- **Anchoring** — "this value is kept alive by that place". Created by loads
  (`x = o.f` anchors `x` to the slot `o.f`), by parameters, by globals. This is
  a directed relation, not an equivalence, and it is where the fixpoint lives.

`crossing_borrows` merges both into one worklist, which is why its result is
weaker than either would be alone: a fact about identity and a fact about
anchoring meet at the same lattice element and the weaker one wins.

## The two fixpoints go in opposite directions

This is the cause of the `borrowed-call` zero, and it is worth stating sharply
because it is the kind of error that survives review.

`crossing_borrows` is a **least** fixpoint: it starts from "nothing is borrowed"
and adds borrows it can prove. For a loop-carried value, the proof is circular —
`at` is borrowed because the head is live, and `at`'s next value is borrowed
because `at` is — and a least fixpoint starting from ⊥ never enters a cycle it
can only justify from inside. So it eliminates nothing on precisely the shape
that traversals are made of.

But borrowing is a **safety** property: *nothing on any path kills the anchor*.
Safety properties are greatest fixpoints. The correct algorithm assumes every
value is borrowed from its natural anchor and then invalidates on evidence:

- the anchor slot is written between the borrow and a use,
- the anchor is released, or its own anchor is,
- the value crosses a suspension point,
- a call runs that may write the anchor slot.

The obligation to release, by contrast, genuinely is a least fixpoint — it
accumulates. Today both are computed by the same upward-climbing worklist, and
one of them is climbing the wrong way. This is not a tuning problem and no
seeding fixes it.

The loop circularity dissolves once the anchor is resolved with the rule that
**a back edge contributes no new anchor**: a block parameter's anchor is the
join of its arguments' anchors over *forward* edges only, and the back edge is
checked against that assumption rather than consulted for it. That is exactly
what a greatest fixpoint does, and it is why it has to be one.

### Measured

`borrowed-call` went from **0% to 40%**, 167 operations to 99, the moment the
loop ran downward instead of upward. It is now exactly level with `traversal`,
which is the same walk without a call in it — so a call in the middle of a
traversal costs nothing at all any more, which was the entire claim.

What keeps it sound is the seed rather than the direction. Only function
parameters, loads and block parameters are ever candidates; an allocation and a
call result are owned and never enter the set, so a block parameter that
receives one is removed on the first pass and takes its whole circle with it.
89 programs agree with node under counting, and nothing in the suite leaked.

## An anchor does not have to be a parameter

`survives_the_function` will only anchor a borrow to a function parameter, and
says why: a parameter is alive because the caller holds it for the length of the
call, while "a value the *function* allocated ... can die here, and the borrow
with it."

That is true and it is not a reason to refuse. `local-anchor` walks a list the
function built, one line different from `traversal`, and eliminates **0 of 85**
where `traversal` eliminates 40% — and the difference is only that one head
arrives as a parameter and the other is a local.

It was worth being wrong about first. `loop-break` was written to blame the
join: a block parameter reached by two edges, one of them not the back edge.
It is not the join. The same walk with the `break` removed also eliminates
nothing, and a walk over a *parameter* with a `break` added still eliminates
28%. The join is fine.

What actually happens is in the IR. The head is passed as a block argument into
the walk and never named again, so its reference **dies on that edge** — and a
cursor borrowed from it would outlive the thing it borrowed from. Refusing is
correct. Extending is the fix: the frame owns the head, nothing else releases
it, and an anchor whose lifetime is stretched to cover its borrows is exactly
what a borrow means.

So the anchor is not a value, it is a *place with a lifetime*, and
`crossing_borrows` returning a set rather than a map from value to anchor is why
it cannot say this. That map is `hir::own`, and lengthening an anchor's live
range to cover what borrows from it is the one thing the current pass has no
vocabulary for at all.

### An anchor and an effect window are one mechanism, not two

Built, and the first half on its own did nothing at all. Letting an owned local
anchor a borrow moved no number: the walk in `local-anchor` is in the same
function as the call to `build`, `build` stores, and `survives_the_function`
scans the *whole function* for a store or a mutating call. The anchor was found
and the effect check threw it away.

Making that scan flow-sensitive -- only what the load's block can reach, because
a borrow can only be invalidated by something that runs after it -- moved no
number either, on its own. There was no borrow left to keep.

Together they moved three: `local-anchor` 0% to 40%, `loop-break` 0% to 26%, and
`store-elsewhere` 0% to 39%, which was not predicted. So these are not two steps
that happen to compose. They are one claim -- *a borrow is good while its anchor
is alive and nothing that runs afterwards disturbs the slot* -- and the old code
was refusing on both halves of it independently.

### The third rule that had to agree

`crossing` already carried a warning: nothing releases one of these and no edge
retains for one, "so every place that decides either has to agree." A third
place decided and did not.

`aCellPerIteration` stores its `sum` cell into a fresh closure once per
iteration. The store *moved* the reference in, and the loop's back edge retained
to make up for it -- two rules, one balance. The moment the value carrying the
cell became a borrow the edge stopped retaining, correctly, while the store went
on claiming a move. One reference, two consumers: the closure and the frame each
gave one back, and the answer came out 4 where node says 9.

A store may not move a borrow, because a borrow has no reference to give away.
That is one line, and finding it took reading the emitted C for one function
with the change and without -- the counts were balanced, the suite was green on
fifteen cases, and only an oracle with a different answer said anything at all.

## A load has three flavors and we emit two

`store-elsewhere` builds a list head first:

```ts
made.next = table.top;
table.top = made;
```

It reports 168 operations against an ideal of 33, and **borrowing cannot close
it**, which is why it was worth adding: the loaded `table.top` has to stay alive
inside `made.next` after `table.top` is overwritten, so no borrow is safe and
the current pass is right to retain.

The operation it needs is not a borrow. It is a **move out of the slot**: the
reference in `table.top` is handed to `made.next`, and the slot is overwritten
immediately after with something that does not depend on it. Nobody needs to
duplicate a count to move a reference from one field to another.

So a load is one of three things, and the compiler has names for two:

| flavor | what it does | Swift's name |
| --- | --- | --- |
| copy | retain, slot keeps its reference | `load [copy]` |
| borrow | no retain, valid while the anchor is | `load [borrow]` |
| **take** | no retain, **slot loses its reference** | `load [take]` |

`take` is legal when the slot is overwritten on every path before any other read
of it, which is a dominance question over facts `verify.rs` already computes.
Every retain in `store-elsewhere` is a missing `take`, and the same shape is
every `push_front`, every accumulator swap, and every list splice in the corpus.

### Measured, and the prediction was half right

`swap` went from 104 operations to **2**, which is its floor: two things to give
back, and a pair that never escapes and so is never an object at all. 98%. The
loop is free, which is what the case was written to ask for.

`store-elsewhere` went from 168 to 66, not to 33. The prediction named the right
mechanism and the wrong total.

What is left is one release per iteration, of `made.next`, which the constructor
had just set to null. `Fresh` tracks which slots are still zero and stops
tracking an object the moment it is handed to a call -- so a constructor, which
is the one call that certainly *only* initializes, is exactly the call that
loses the fact. That is callee effects, and it belongs to the per-parameter
summary rather than here.

So the floor of 33 stands and the distance to it has moved from `take` to
`writes`. A prediction that lands on the right mechanism and the wrong number is
worth more than one that lands on neither, and it is still wrong.

## Effects: one summary per function, with per-parameter columns

`mutating(program)` is a boolean per function. Any store anywhere means "this
function stores", and storing ends every borrow that crosses the call. That is
why `store-elsewhere` cannot borrow the read of `table.top` even in the loop
where nothing could alias it, and it is most of why `awfy-towers` sits at 6.9x.

The replacement is not a fourth analysis. `signatures.rs` already does
per-parameter interprocedural inference and has the hard parts worked out — what
a root has to publish, how a dispatch slot is spelled once for a whole
hierarchy, where the ABI wall is. `escape.rs` already computes per-argument
escape. The proposal is that these become columns of **one** summary rather than
three summaries:

| column | question | who wants it |
| --- | --- | --- |
| `escapes` | does the callee let this argument outlive the call? | frame promotion |
| `writes` | which slots, by name, can the callee write? | borrow invalidation |
| `consumes` | does the callee take the caller's reference? | move vs retain |
| `returns` | is the result a borrow of an argument, and which? | **`borrowed-call`** |

The last column is the whole of the `borrowed-call` zero. A function that
returns `list.head` returns a borrow of parameter 0, and a caller that knows
that can keep borrowing across the call instead of retaining at it. Nothing in
the compiler can currently say that sentence.

Slots are named by *field name, never by type* — that rule is already in
`field_name` and it exists because a subclass shares its base's layout, so two
different types can be the same slot. Whatever writes this summary inherits that
rule rather than rediscovering it.

Conservative in the safe direction on the two walls that exist: a virtual call
writes an unknown slot unless the whole hierarchy is visible, and an external
call writes everything.

## Erased values are a representation, not a third ownership kind

An `NtsValue` is a reference only when its tag says so, which reads like it
needs a `MaybeOwned` between `Owned` and `Borrowed`. It does not, and adding one
would double the lattice for nothing.

Ownership of an erased value is `Owned`; what changes is the *code*, which is
already written: `nts_value_retain` and `nts_value_release` inspect the tag.
A conditional obligation discharged by a tag check is still exactly one
obligation. And borrowing an erased value is never *less* safe than borrowing a
reference — if the tag says it is not a reference there is no referent to
outlive anything.

So conditional ownership belongs in lowering, and the lattice stays at three
elements. What erasure does cost is recorded elsewhere and is not this: an
erased value has no known uniqueness, so it can never be reused in place, which
is a real entry in the precision ledger in `typescript.md` §16.

## Linearity is local here, and identity is not

Swift's OSSA enforces "consumed exactly once on every path" with explicit borrow
scopes — `begin_borrow`/`end_borrow` bracketing every borrowed range — because
its values live across phis and its verifier has to bound them.

Block-parameter SSA does not need that, and this is the one place where the form
we already have is strictly better. A value's live range **cannot cross a join**:
if it is live in a successor it is a different value there, passed explicitly.
So "consumed exactly once" is checkable within a block plus its outgoing edge
arguments, with no dataflow at all — a linear scan per block.

The trade is precisely the one this record opened with. Block parameters make
ownership *local* and identity *non-local*, and the current code enjoys neither
half: it does not exploit the locality, and it surrenders to the non-locality.
Spelling the edge mode buys back the second without giving up the first.

`verify.rs` already computes dominators, RPO, reachability and dominance. The
linearity check is a verifier rule that needs nothing new, and it should be a
verifier rule rather than a pass output, so that a pass which breaks ownership
fails the gate instead of leaking quietly.

## The runtime is a second mutator, and the model has to say so

Everything above describes counts the *compiler* emits. The collector emits some
too, and the model is incomplete until it says what it is allowed to do.

This is not hypothetical. `nts_collect_cycles` destroyed a zero-count candidate
in the middle of the pass that was trial-deleting the others, and a real release
landing on a count that had been trial-decremented read a number that did not
mean what it said. It leaked one link out of every list built head first, at
every length above two — and in a heap one shape further along, it freed an
object a live candidate still pointed at. The counts balanced perfectly the
whole time. `runtime/c/tests/cycles.c` is the regression.

So, as rules the model owes:

- The collector consumes only references **the heap itself owns**, never one a
  frame holds. Trial deletion may make a count temporarily untrue, and no real
  release may run while it is.
- Deferred destruction does not break linearity. "Consumed exactly once" is
  about decrements, not about frees; when the memory goes back is below the
  model.
- A dying object's count stops being observed — the `NTS_DYING` early return
  drops a decrement on purpose, and that is sound because the object is being
  freed either way. Linearity holds over live objects, and that is the exact
  scope it holds over.

## What this unlocks, which is the reason to want it

**Frame promotion gets the same answer.** `escape.rs` becomes a reader: a value
whose identity class never reaches a place outliving the frame goes in the
frame. `awfy-bounce` is 4.05x on allocation, not on counting — five refcount
operations in the entire program — and an array of non-escaping objects stored
inline is most of `awfy-towers` too.

**Uniqueness becomes askable.** A value that is `Owned` and alone in its identity
class at the point it is consumed can have its storage reused rather than freed
and reallocated. That is Perceus's reuse analysis, and it is the mechanism for
in-place string append — `node-utf8` at 2.97x node, with `nts_concat_into` and
the `storage` field on `OpKind::Call` already in place and nothing able to prove
the precondition.

Both of those are today separate wishlist items. Under one ownership answer they
are the same query with different consumers, which is the argument for doing this
before either of them.

## Getting there without a flag day

The rule that everything else in this tree is built on is measure, one change,
gate, commit. A rewrite of the counting pass is the exact shape of change that
rule exists to prevent, so:

1. **Compute and do not use.** Land the ownership map, the edge modes and the
   summary, with nothing reading them. Add a cross-check: everywhere the current
   pass elides, the new model must agree it is safe. Disagreements are reported,
   not fatal. Any place the model is *more* conservative than five ad-hoc
   predicates is a place the model is wrong, and this is how that gets found
   before it costs anything.
2. **Switch one consumer.** Borrow decisions first, since `borrowed-call` and
   `traversal` are the cases with the most headroom and the memory suite already
   reports both. `NTS_RC_NAIVE` stays; add a switch for the old pass so the suite
   can print three columns rather than two during the change.
3. **Then the loads,** then frame promotion, then delete the predicates.

The `actual` column of `tooling/memory` is the ratchet, down only, the way the
`rc` gate step already works. Nothing in this plan is allowed to raise it.

## What would say this is wrong

- ~~**The greatest fixpoint does not move `borrowed-call`.**~~ Tested. It moved
  it from 0% to 40% with no other change, and `rc` stayed at 91 of 91. The
  direction was the whole of that case.
- **Edge modes cannot be maintained.** If `simplify` or `specialize` cannot state
  a mode for an edge they rewrite without a fixpoint of their own, then the fact
  does not belong in the IR and the honest answer is one shared analysis rather
  than a spelled one.
- ~~**`take` does not close `store-elsewhere`.**~~ Tested, and it landed short:
  168 to 66. The ideal was right and the attribution was not -- the remainder is
  a constructor's writes, not a load's flavor.
- **The suite is measuring the wrong thing.** Operation counts are not time.
  Every case here should have a benchmark row before any of this is called a win;
  `awfy-list` went from 12.97x to 1.80x on elision, so the two do track — but
  they are not the same number and this record is not entitled to assume it.

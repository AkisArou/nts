# The refusal was in front of the bug

Reading a `Void` contextual type as erased is three characters. It fixes
`value: undefined` and `return undefined` from a `void` function, every example
agrees on all three backends — and it turns **12 of 24 addons** into
`refusing to emit code from invalid HIR`.

```text
NotDominated { func: "Closure48#call__resume", value: ValueId(4),
               used_in: BlockId(8) }
```

It does not introduce that. The refusal had been standing in front of a
generator-resume path, and removing it was the first thing ever to compile one.
Yesterday that was a reason to revert ([[0325]]). Today it is a reason to go
look at what was behind it.

## What was behind it

`hir::suspend::crossing` decides which values need a frame slot: the ones live
across a suspension. A rejection handler is reached from the **state dispatch**,
not from the `await`, so liveness on the unsplit function does not carry values
into it along that edge — and the code knows this, because it already spills
what is *passed* to the handler:

> What a rejection owes its handler crosses the suspension too, and it is the
> one set that does not follow from liveness […] `NotDominated { value: %14,
> used_in: b6 }`, from the first program whose `try` had both a `throw` and an
> `await` and a local they disagreed about.

That comment found this failure once and fixed the half its own program
exercised: the handler's **arguments**. A handler is a block like any other and
can also *read* any value that was live before the `await` — a closure out of
the captured environment, in this case, and called rather than passed.

`live.live_in(rejection.handler)` is the whole set, and it was available all
along, because `crossing` runs on the **unsplit** function where the handler is
an ordinary block liveness has already solved.

## Twenty-one things behind a three-character diff

```text
`X` or `X` where what it stands in for is not a reference
    21 things, 31 sites, 16 modules      — the 6th cause in the census
```

Refusals after: util −16, net −18, assert −16, stream −17.

## No fixture tests the repair, and that is measured

Two arms were written to exercise it — an async function whose `catch` calls a
captured closure, then an async **arrow** taking the handler as a parameter,
which is the shape of the failing `Closure48#call__resume`. Each was run against
a build with the repair **reverted**. Both passed.

So neither reaches it. The repair's witness is the corpus — twelve addons going
from invalid HIR to building — and `addons` is its guard.

**This is the reduction trap from the far side.** The usual failure is a probe
that exercises a feature and avoids the observable ([[0325]]). This is a probe
that reproduces the *description* of a failure without reproducing the failure,
and from the inside the two are identical: the arm compiles, it agrees, the
comment above it is a correct account of the bug. Only running the old compiler
separates them.

Saying so in the example is worth more than an arm with a confident comment. A
fixture that claims to guard something it does not is worse than no fixture,
because the next person deletes the real guard as redundant.

## The order, which is the argument for reverting rather than forcing

```text
yesterday   the repair, measured, 12 addons red      -> reverted, filed
today       read the filing, fix what it named       -> the repair lands
```

The revert was not caution. It was what turned a broken change into a located
bug: the blocker recorded a `NotDominated` with a function name and a block
number in it, and that was the whole of the investigation a day later.

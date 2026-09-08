# Both refusals argued correctly from a premise the tree no longer held

Two defects in this batch were not oversights. Each was a decision, written down
with its reasoning, and the reasoning was sound when it was written. Each had
since become false, and neither comment could tell.

## One: a null slot is worse than a link error

`drop_orphaned_bodies` drops a body that calls something the C backend refused,
to a fixed point. Its doc comment ended:

> Direct calls only. A dropped function that a dispatch table names is still a
> dangling symbol and still a clang error -- unchanged, rare, and not made worse
> here; `emit_object_descriptors` reads the program's layouts rather than these
> bodies, so the two would have to be reconciled and a null slot is worse than a
> link error.

Every clause is true as stated. A dangling symbol *is* a clang error, which
stops; a null slot compiles and dereferences. Given the choice, the loud failure
is the right one.

The choice stopped being between those two. `runtime/node/timers` passes two
functions to one call, and the two were refused by *different passes* — one by
the lowering, one by the backend. The lowering's refusal ran before the layout
was built, so that closure got no table at all: `methods` is `0`, and it
compiles. The backend's refusal ran after, so that one kept a table naming a
`Closure54__call` nothing defines: clang stops.

    NTS1003  `Closure55#call` cannot be compiled because it calls `processTimers`
    NTS2009  `Closure54#call` cannot be emitted because it calls `processImmediate`

Both printed. Both emitted anyway. So the program already had the null slot the
comment was avoiding, arrived at by the other refusal path, and the trade it
described was not available: one of the two was going to be silent whichever way
the table was written.

The Node lane found it by bisecting the module after six hypotheses failed —
each plausible, each a probe, and the bisect took two steps. Its general
statement is the one that mattered: *a descriptor with a null `methods` pointer
is never correct and is checkable at emission.* Once that check exists, nulling
the slot is no longer the worse half of anything. The tables now take the
surviving body names, a slot whose body is gone is written null, and a closure
that has nothing left to dispatch to is a diagnostic.

## Two: it needs a third helper that knows the layout

Settling a promise chooses its runtime helper from the payload's type. The
erased arm refused:

> The runtime settles a promise with a number or with a reference, and an erased
> value is neither: it is a tag beside a payload, so fulfilling with one needs a
> third helper that knows the layout. Refused rather than settled through
> whichever arm looks closest, which is how a reference payload would have gone
> out as a double.

Right about the danger, and right that a third helper is what it needs.

`nts_promise_fulfill_value(NtsPromise *, NtsValue)` is declared fourteen lines
below the two the comment names, is implemented in `nts_runtime.c`, and has an
arm in the JVM backend and a signature in the LLVM table. All three backends
could already emit it. The refusal named the missing thing precisely enough to
have found it, and nobody looked.

Meanwhile the *reachable* half of the same site was emitting
`nts_promise_fulfill_tagged(v3, (NtsHeader *)v2, v7)` with `v2` an `NtsValue` —
because the helper was chosen from the payload the signature *declares* while
the value handed over was whatever the flow had left, and those had drifted
apart. The value is now coerced to the declared payload before the helper is
chosen, which is what made the erased arm reachable at all.

## What is actually being recorded

Not "read the header". Both comments are better than the code around them, and
deleting either would have made the tree worse.

A refusal that explains itself well is doing two jobs. It tells a reader why the
answer is no, and it states a condition under which the answer becomes yes — and
nothing rechecks the second one. `git blame` says the tree moved; the comment
cannot. In one case the condition was answered by a helper someone added to the
runtime; in the other it was answered by a guard added to the emitter earlier
the same day, by me, for a different reason entirely.

The cheap version of the check is to grep for the thing the comment says is
missing, at the moment you next touch the file, rather than to trust that
whoever added it would have come back. Neither of these needed research. One was
a name in the same header; the other was a function I had written that morning.

## What it cost and what it bought

Between them, and the four ordinary bugs found alongside, `runtime/node` went
from one module compiling to twenty of twenty-two:

    assert 20 -> 0   events 11 -> 0   stream 11 -> 0
    fs     14 -> 1   timers  2 -> 0

`fs` keeps one: a captured field declared erased and read back concrete, which
the verifier accepts. `process` keeps twenty, most of them native bindings that
do not exist yet and three global names colliding with a C header — the same
shape as the field named `header`, one namespace over, and not yet fixed.

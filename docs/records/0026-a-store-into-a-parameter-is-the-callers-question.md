# 0026 — A store into a parameter is the caller's question

Two facts the compiler already had and did not use. One of them was worth every
constructor argument in every program; the other was worth thirty-four
operations in a case that had to be built three times before it showed anything
at all, and the two failures are the more useful half of this record.

## `this.label = label`

`escape.rs` decided a store where it found one. If the container was an
allocation this function made, the store added an edge: what goes in escapes if
the container does. Otherwise the stored value escaped, full stop.

A constructor's container is `this`, which is a **parameter**. So

    class Config {
      readonly label: Label;
      constructor(label: Label) { this.label = label; }
    }

sent `label` to the heap. Not for a caller that lets the config escape -- for
every caller, including one whose config never leaves its frame, which after
`0025` is most of them. That is nearly every constructor that takes a reference,
which is nearly every constructor of anything with structure.

It was never this function's question. What the value escapes into is the
container, and whether *that* outlives anything is the caller's answer. So the
pair is published -- `stores_into` returns `(what, into)` per function -- and the
caller adds the same edge the local store adds, one frame further out.

The caller has to ask both of the questions the local store asks, and the second
one cost a crash to remember:

    pile.push(new Disk(i))

A fresh disk every iteration, all of them going into one pile. The frame has one
slot for that allocation and the loop reuses it, so the pile ended up holding
seventeen pointers to the same disk, and `guarded-push` -- which exists because
`awfy-towers` has a guard -- read a size that was not there and threw. The local
store had guarded that since it was written. The caller-side edge now carries
the same guard, and a unit test holds it.

## And it is worth nothing on the benchmarks

Measured after, under `NTS_BENCH_RC=1`: every row within noise of where it was,
and nts's own times identical to three digits on the ones that look moved --
`awfy-permute` 12.08 -> 12.09 us with its C++ reference wandering 9.06 -> 8.44.

That is not a surprise once stated. The benchmark suite's object graphs are
lists, piles and trees: things built to outlive the loop that built them, which
is exactly the case where the container escapes and the edge carries the escape
straight through. The constructor argument that goes in a frame instead of the
heap is the case where the *whole structure* is local, and no row here has one.

The gain is real and the suite cannot see it. Worth saying rather than leaving
a reader to assume a table that did not move means a change that did nothing.

## What placing more objects in frames found in the other backend

The escape change put more objects in frames, and `examples/cycles` began
dying of signal 11 under LLVM while the C backend ran it. Two bugs, both older
than this change and both reachable only once enough objects were placed.

**The `alloca` was where the allocation was written.** `selfCycle` makes a
`Node` per iteration and takes the round count from its caller, so the loop
took another `sizeof(Node)` of stack every time round and gave none of it back
until the function returned. The C backend declares frame storage with the
function's other locals -- one slot per allocation *site* rather than per
execution of it, which is correct precisely because nothing outlives the
iteration that made it -- and this backend already knew that. `frame_storage`
says so, in a comment about strings:

> An `alloca` runs where it is written, so one emitted beside its call sits
> inside whatever loop the call is in and takes another 186 bytes of stack
> every iteration.

It was written for `benches/substrings` and never applied to objects.

**And the storage was never zeroed.** `nts_object_new` returns memory that is
already zero, and this compiler is built on that: a store over a zero
disconnects nothing, so it needs no release, which is what `own::still_zero`
proves and what lets a list be built without counting. An `alloca` holds
whatever the last frame left there, so the first store to a reference field
released a stale pointer -- and an optional property nobody assigned read as
whatever was on the stack rather than `undefined`.

That second one was costing a whole example before any of this:
`examples/optional-properties` failed under LLVM and passes now. It had nothing
to do with the change that found it.

## `readonly`, and two measurements that showed nothing

`Field::readonly` has existed since layouts did. Its comment calls it
load-bearing: `const` in C, `ACC_FINAL` on the JVM, hoistable loads, no write
barrier. `0025` had already taken the `const` away -- a frame-declared struct
written through a cast is undefined where a heap one is not -- with the note
that the fact stays in the HIR "where a field load that cannot change is
something this compiler can common up itself".

Nothing read it. A borrow out of a `readonly` slot was ended by any call that
stores, because `mutating` records that a function stores and nothing finer.

The first case put a borrow of a `readonly` field across such a call. It moved
nothing. The second made the container escape, so the borrow was a real one
rather than one out of a frame object that costs nothing either way. It moved
nothing either. Both were wrong for the same reason, which was in the code the
whole time: `harmless` is `initializing_only`, and a store of a **number** can
never disconnect a reference, so the call was already known to leave every
borrow standing. Two cases spent on a slot that was never in danger.

The fact only pays when a call stores a reference over a live one -- the single
kind of store that can drop something -- and the borrow comes out of a slot the
language says that call cannot write:

    readonly-anchor   77 -> 43 operations

Seventy-seven is the naive count. Every read of a field the checker had proved
constant was being counted, and the checker had said so all along.

## What the rule trusts

That a `readonly` field is never written. TypeScript enforces this in the
checker and not at runtime, so `(cfg as any).label = other` gets past it. A
store like that *inside this function* still ends the borrow -- the local arm
checks the slot by name and an erased container has no name it can match, which
is the answer that rules nothing out. What the rule now permits is one hidden
inside a callee.

This is the same trust `Field::readonly`'s own comment already spends, on
larger things: `const` on a C member and `ACC_FINAL` on a JVM field are both
promises a backend makes to its optimizer about storage, and both are wrong if
the field is written. Eliding a retain is strictly less than either. If that
trust is ever withdrawn, all three go together.

## What the failures are worth

The rule was stated before it was measured, twice, and both statements were
about a slot no borrow was ever at risk in. The rule that finally applied is
narrower than the one written down: not "a `readonly` slot cannot be
invalidated" but "a `readonly` slot cannot be invalidated *by a call*, which is
the only invalidation that was ever coarse enough to be wrong about it". The
local store already checked the field by name.

A fact being computed and unread is not evidence it is worth reading. It is a
place to look.

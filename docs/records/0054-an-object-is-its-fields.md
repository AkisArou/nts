# 0054 — An object is its fields, and the audit that was never written

`object and class` sits between array (0038) and function and closure (0040) in
the queue. Both of those have a record. This one was audited, closed, and left
without one — its three ratchets are real and green, and the argument for its
representation existed only in the code.

`docs/primitives.md` made that visible by putting the nine primitives in one
table with a column for the record, and this row's cell was empty. Written now,
from the code as it stands rather than from memory of what was decided.

## Representation

An object is a header and its fields, inline:

    struct NtsObj_Counter {
        NtsHeader header;
        double count;
        double step;
    };
    _Static_assert(sizeof(NtsObj_Counter) == 40u, ...);
    _Static_assert(offsetof(NtsObj_Counter, count) == 24u, ...);
    _Static_assert(offsetof(NtsObj_Counter, step) == 32u, ...);

No indirection between an object and what it holds, and no descriptor lookup to
read a field — the offset is a constant the emitter computed. The
`_Static_assert`s are why that is safe to say: the C compiler checks nts's
layout arithmetic against its own on every build, for the size and for every
offset, so a disagreement is a build failure rather than a wrong read.

**It can live in a frame.** `examples/instances` frame-places fifty-two
objects — `NtsObj_Counter v2_frame` on the C stack, with
`header.reserved = NTS_IMMORTAL` so that every retain and release of it returns
immediately. An object that does not escape costs one stack slot and no
allocation at all, which is what `no-escape` and `closure-capture` read zero for.

**A vtable only where the hierarchy needs one.** `Counter` has no subclass and
its descriptor's method table is `0`; its methods are `static` C functions
taking the receiver, called directly. `Shape` and `Rectangle` each get a
`nts_vtable_*` because `area` is overridden, and only then does a call go
through `descriptor->methods[slot]`.

**What the checker knows and this does *not* drop:** `readonly`.
`Field::readonly` is semantic rather than syntactic — `Readonly<T>` counts — and
`own.rs` reads it: a borrow out of a `readonly` slot cannot be ended by a call,
because no callee can write it. `readonly-anchor` is the case, and its own
`expected` records that the field had been computed since layouts existed and
nothing had ever read it while its comment called it load-bearing. 40 operations
against 2 allocations.

## Operations

A field is a struct member. A method is a static call, or an indexed load from
the descriptor's table where the hierarchy has more than one implementation.
`new` is `nts_object_new`, or nothing at all where the object is frame-placed.

There is no method surface here the way there is for a string or an array —
an object's operations are the ones its own class declares. What the primitive
owes is that reading a field is a load and calling a method is a call, and both
are.

## Memory fit

**Cyclicity is decided per type, from the types alone.** An object of type `T`
can be in a cycle only if `T` is reachable from `T` by following reference
fields: `class Wrapper { inner: Leaf }` never can be however many `Wrapper`s
exist, and `class Node { next: Node }` always can and takes one line to write.
Answering it in the compiler is what keeps the collector off every program with
no cycles to collect — the alternative buffers a candidate on every release that
does not reach zero, which is most of them.

## The one thing this audit found, and the reason it is not a change

An **array of references is conservatively cyclic**, and the reason is in the
code: every array of references shares a single descriptor, which describes the
element's *shape* and not what the element points at, so there is nothing
per-element-type to be precise with. A field whose type has no layout is cyclic
for the same reason — the answer is unknown, and unknown has to mean yes.

So `Wrapper[]` is a collection candidate on every release, where a lone
`Wrapper` is not, and the two have exactly the same reachability.

That is a real imprecision and it is **unmeasured**, which is the honest finding
of writing this record. It is not a change here because making it precise means
a descriptor per element type rather than per array shape — a representation
change to arrays, which is 0038's axis and not this one — and because no case on
the board releases enough arrays of references for the cost to have a number.
Naming it with a reason is what this record can do; a case that puts a number on
it is what the next person should write before anyone changes a descriptor.

## The three ratchets

**Correctness.** `instances`, `classes`, `inheritance`, `accessors`,
`field-defaults`, `fluent-this`, `subclass-field`, agreeing with node.

**Memory.** `subclass-field` 0 / 0, `nulled-field` 17 / 17, `readonly-anchor`
40 / 2, `array-of-objects` 18 / 22, `store-elsewhere`, `traversal` and
`borrowed-call` 33 / 33.

**Speed.** `objects` 1.00x C++ and 0.84x node; `dispatch` 0.99x C++ and 0.67x
node. Both lose to bun, and 0049 has the measurement for why: on both rows bun
also beats C++, so it is a place a JIT wins over static compilation rather than
a place this backend is behind.

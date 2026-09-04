# 0076 — What the goal asked for, and what I had not shipped

A check-in made me audit five features against the goal's own bar. Every one
ships with four things: an example, unit tests covering the refusals, a
`tooling/memory` case with floors argued *before* measuring, and a
`benches/cases` row — "missing any means unfinished".

    feature              example  tests  memory  bench
    try/catch/finally       yes    yes     yes    yes
    new Promise             yes    yes      no     no
    labels + defaults       yes    yes      no     no
    instanceof              yes    yes      no     no
    ?.() and ?.[]           yes    yes      no     no

Four of five were unfinished by the standard I was working to. This closes what
can be closed and gives the reason for what cannot, because a missing artifact
with no reason is indistinguishable from an oversight.

## Predictions first, then the measurement

Three memory cases, floors argued before running. One prediction held and two
did not, which is the point of writing them down first.

**`instanceof-class`: 0 operations, 0 allocations — held.** The shape does not
leave `work`, so it stays in the frame; the operand is erased on the way into
the test and an erase is what it wraps. Committed.

**`optional-call`: 0 and 0 — wrong, three times over.** The first version built
its holder through a factory: 17 allocations, because a returned object escapes
its callee and this compiler has no inliner. The second put the holder in the
frame and used a named function: allocations went to 0 as predicted, but 19
operations remained — the walk over the frame object's dying erased field, which
`inert_slots` cannot prove inert because it gives up on any function containing
a call. The third used a module-level array to remove the object entirely: 0
allocations and 10 operations, one per iteration, for a *global read merged with
a null* that nothing recognises as immortal.

That third number is the interesting one. It is the same family as the
`costs_nothing`/`counted_here` split in 0071: a read of an immortal static is not
recognised as costing nothing, so a borrow of one is counted. I can argue the
floor to zero and the compiler does not reach it, and the suite is right to
refuse a case above its floor. **No memory case for the optional family**, and
that missing rule is the reason.

**`new Promise`: no case is possible with this harness.** `tooling/memory/harness.c`
declares `double work(double iterations)`. An `async` entry point returns a
promise, which the harness reads as a double — the first attempt reported
`answer=0` where 36 was correct, and three "leaks" that were the promise chain
never being driven. There is no synchronous way to observe a settled promise's
value, so any case either mistypes the entry point or is eliminated as dead. The
gap is in the harness, not in the feature: it would need a way to drive the loop
to quiescence before reading.

## Two benchmark rows, and what each turned out to measure

    case              C++       nts C    nts LLVM       node        bun    nts/C++  nts/node
    instanceof    57.97 us    44.80 us    44.89 us   982.60 us   195.00 us    0.77x     0.05x
    optional-chain 20.57 us   83.62 us    83.61 us   348.29 us   171.53 us    4.06x     0.24x

**`instanceof` came in under its ceiling**, and not because the test is free:
the reference returns a `Shape` by value every iteration while nts frame-places
its shapes and folds the test against a descriptor it can see. 22× node, which
walks a prototype chain where this compares a pointer.

Writing it found the limitation 0074 documented, immediately. The first version
had `class Circle extends Shape {}` with no field of its own — structurally
identical to `Shape` and to `Square`, therefore one descriptor, therefore
`s instanceof Circle` true of everything. nts computed 100000 where node
computed 199999 and the benchmark refused to run. The checksum is what caught
it; nothing else would have.

**`optional-chain` is 4.06× its ceiling**, and the first version was 72×. That
first version built its holder through a factory: two heap allocations an
iteration, 1.47 ms against 20.57 us, with the optional call invisible
underneath. Real, and not what the row is named for — it is the allocation axis
the carried-forward list already tracks under `awfy-bounce`.

The honest version isolates the call, and 4.06× is two named costs:

    struct NtsObj_Held { NtsHeader header; NtsValue fn; };
    v24 = ((double (*)(NtsObj_Fn4 *, double))v19->header.descriptor->methods[0])(v19, v23);

An optional field of *reference* type is a **sixteen-byte tagged value** where a
nullable pointer would do — `f?: F` with `F` a reference and no `null` in the
type has exactly two states, and a null pointer distinguishes them. And the call
is a table dispatch, three loads, where C++ has one function pointer.

The first of those is a representation change with a number attached to it now,
which is the shape the goal asks for. It is not made here.

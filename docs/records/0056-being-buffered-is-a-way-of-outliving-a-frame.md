# 0056 — Being buffered is a way of outliving a frame

0055 found a segfault and left it open. This is the fix, the two numbers it
costs, and the first version of it, which a case refuted in one line.

## The bug

A `Leaf` that escapes nothing — made, stored into an array, dropped in the same
frame — was placed in the frame, and the array it went into was on the heap:

    NtsObj_Leaf v1_frame;
    v13 = nts_array_new(&nts_desc_ref, v12);
    NTS_ITEMS(v13, NtsObj_Leaf *)[0] = v1;      // v1 is &v1_frame

Every reachability argument says that placement is right. Nothing in the program
can see the `Leaf` after the frame returns; the array cannot either, because it
dies with the same frame.

What can see it is the **candidate buffer**. `nts_release` on a buffered object
whose count reaches zero does not free it:

    object->reserved = 0;
    nts_paint(object, NTS_BLACK);
    if (object->flags & NTS_BUFFERED) {
      /* The candidate buffer is holding it. Freeing it now would leave the
       * buffer pointing at memory that is gone; collection frees it instead,
       * which is where the buffer is emptied. */
      return;
    }

So the array outlives the release that should have ended it, and outlives the
frame with it. At exit `nts_destroy` drains the buffer, walks the array for
references, and reads a `Leaf` that is dead stack — `nts_release_contents` with
`object = 0x7fffffffd618`, which is why 0055's evidence had a stack address in
it.

**Being bufferable is a way of outliving a frame**, and it is one escape
analysis cannot see: no program-visible reference outlives anything. It is the
collector's own bookkeeping that keeps the container, so the question has to be
asked where the container is chosen rather than answered by the fixpoint.

## The fix

`escape.rs` defers each store — what goes into a container escapes exactly when
the container does. One condition is added to whether a container may confine at
all:

    fn buffers(ty: &HirType) -> bool {
        matches!(ty, HirType::Managed(ManagedType::Array(element))
                     if element.may_hold_a_reference())
    }

A container that can be buffered cannot confine a frame allocation, so what goes
into it escapes and lands on the heap.

## The first version, and the case that refuted it

It read `cyclic_layouts` as well, so that an object of a self-referential type
was bufferable too. That is true of the descriptor and wrong here, and
`tooling/memory/cases/cycle` said so immediately: two objects that point at each
other, both in the frame, and the case's floor is **0 allocations**. The first
version produced eighteen.

The reason is one line of the runtime. `place_allocations` frames *every*
`ObjectNew` that does not escape, and a frame allocation carries
`NTS_IMMORTAL` — its release returns before it can be offered to anything, so it
is never buffered. An object that *does* escape takes what it holds with it
through the fixpoint. Either way the question never arises for an object.

An array is different only because it is never frame-placed: `place_allocations`
frames an `ObjectNew` and a string-returning `Call`, and nothing else. So an
array is on the heap, it is released, and a release above zero asks the
collector.

Being *buffered* takes being *released*, and only a heap allocation is. That is
the whole distinction, and the broad version missed it by reading the descriptor
instead of asking who ever gets released.

## What it costs, measured

`tooling/memory/cases/cyclic-array`, the program from 0055, elided:

    before   retains=0 releases=6 allocated=2 candidates=0    (exit 139 naive)
    after    retains=2 releases=6 allocated=4 candidates=0

Two `Leaf`s to the heap and one retain each, in exchange for not segfaulting.

**Every other case in the suite is unchanged** — `closure-capture` still 0 / 0,
`array-of-objects` still 18 / 22, `pile-shuffle` still 9 / 11, `cycle` back to
0 / 0. The rule fires where an array of references holds something that would
otherwise be in a frame, and nowhere else on the board.

## The number 0054 asked for

0054 named an imprecision and could not measure it: an array of references is
conservatively cyclic, because every such array shares one descriptor that
describes the element's *shape* rather than what the element points at. So
`Leaf[]` is a candidate where a `HoldsOne` of identical reachability is not.

It now has a price, and it is not the one anyone was looking for. In the naive
build it is one buffered candidate against zero. In the **shipping** build it is
two heap allocations and two reference operations — because elision removes the
releases that would ask the collector anything, so the conservative answer never
costs a collection here, and costs placement instead.

A descriptor per element type would take `allocated` back to 2 and the naive
`candidates` to 0 in one change. `cyclic-array` holds both numbers still until
someone does it.

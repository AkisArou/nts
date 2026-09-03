# 0055 — A third counter, and a crash it found

0054 named an imprecision and did not measure it: an array of references is
conservatively cyclic, because every such array shares one descriptor that
describes the element's *shape* rather than what the element points at. So
`Wrapper[]` is a cycle candidate on every release above zero where a lone
`Wrapper` of identical reachability is not.

It said the case that measures it should come before anyone changes a
descriptor. Writing that case is this record, and it did not get as far as the
measurement.

## The counter that was already there

    /* How many candidates have ever been buffered. For tests: an acyclic
     * program must never buffer one, and the only way to state that is to
     * count. */
    size_t nts_cycle_candidates(void);

Written for exactly this question and read by nothing. `tooling/memory` counted
reference operations and allocations and not this, so a program could buffer a
candidate per release and every case would stay green.

The harness reads it now, as a delta — `nts_counting_reset` does not clear it,
being cumulative — and `run.sh` asserts it against an optional `candidates N`
line in `expected`. Optional because most cases would be asserting a zero they
never come near; a case says it when it is *about* the collector.

## The case, and the crash

Two `Leaf`s, a `HoldsOne` and a `HoldsMany`, each field stored over while a
local still holds the old value — so each release lands at one rather than zero
and `nts_possible_root` is asked. `HoldsOne`'s answer is no and the array's is
yes, which is the conservatism in the smallest program that shows it.

It never reported a number. Under `NTS_RC_NAIVE` it exits 139.

    Invalid read of size 4
       at nts_free_storage (nts_runtime.c:294)
       by nts_free / nts_destroy / nts_collect_cycles
       by main (tooling/memory/harness.c:44)
     Address 0x0 is not stack'd, malloc'd or (recently) free'd

    (gdb) p *object
    $2 = {descriptor = 0x0, reserved = 1099511629824, flags = 256, length = 0}

`0x55555556b077` is not eight-byte aligned, so it is not an object at all — a
corrupted pointer in the candidate buffer, with `nts_roots_len` at 1. The
program agrees with node under the differential and runs clean elided; only the
naive build crashes, and `total heap usage: 4 allocs, 0 frees` says nothing had
been freed before it.

## The diagnosis, and its contradiction

The emitted C shows a frame-placed object stored into a heap array:

    v13 = nts_array_new(&nts_desc_ref, v12);
    NTS_ITEMS(v13, NtsObj_Leaf *)[0] = v1;      // v1 is &v1_frame

Both builds frame-place identically; what the naive build adds is the
retain/release around the store-over, which pushes the array's count above zero
and buffers it. So: the candidate buffer keeps a heap object alive past the
frame its *contents* live in, and the collector then walks a dead stack slot.

That diagnosis fits every piece of evidence above, and it is wrong, or at least
not sufficient. Removing the store-over so nothing is released above zero:

    retains=2 releases=7 allocated=2 candidates=1 leaked=-7   exit 0

A candidate is still buffered and it does **not** crash. And `leaked=-7` is a
second anomaly — a negative live-count delta, meaning the collect freed seven
things the count did not expect.

So the crash needs more than "buffered": buffered, released to zero, and holding
a frame pointer. Which of those three is the unsound one is not settled, and the
standing rule is to distrust a diagnosis nothing has contradicted. This one has
been contradicted by the second test I ran.

## What is committed, and what is not

The counter and its assertion are committed: they are an instrument, they made
the suite able to state something it could not, and the suite is green with them.

The case is **not** in `tooling/memory/cases`. A failing case is a ratchet doing
its job, but one that segfaults takes the gate down for everyone, and this is
not a bug to half-fix at the end of a long sitting — it is escape analysis or
the collector, and both are memory safety. The program is kept at
`docs/reproductions/cyclic-array-frame-escape.ts` with the recipe above.

Two things for whoever picks it up. `leaked=-7` on the non-crashing variant is
probably the same bug seen from the other side and is the cheaper end to pull.
And the original question — what the conservative array cyclicity actually costs
— is still unmeasured, because the case written to measure it never got a number.

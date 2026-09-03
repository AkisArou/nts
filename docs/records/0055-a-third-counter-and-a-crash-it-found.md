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

## The diagnosis, and two tests that looked like contradictions

The emitted C shows a frame-placed object stored into a heap array:

    v13 = nts_array_new(&nts_desc_ref, v12);
    NTS_ITEMS(v13, NtsObj_Leaf *)[0] = v1;      // v1 is &v1_frame

Both builds frame-place identically; what the naive build adds is the
retain/release around the store-over, which pushes the array's count above zero
and buffers it. So: the candidate buffer keeps a heap object alive past the
frame its *contents* live in, and the collector then walks a dead stack slot.

**That diagnosis is right.** 0056 fixes exactly it. What follows was written
when it looked wrong, and is kept because both tests that seemed to refute it
were bad tests, which is the part worth having.

*Removing the store-over*, so nothing is released above zero:

    retains=2 releases=7 allocated=2 candidates=1 leaked=-7   exit 0

A candidate is buffered and it does not crash. But with nothing released above
zero the array is never *destroyed* while buffered, so its contents are never
walked -- and the walk is the crash. The test removed the symptom along with
the cause. Not a contradiction.

*Forcing `first` to escape*, so that it could not be frame-placed: still exit
139, and `grep -c "v1_frame"` returned 0, which I read as "no frame-placed
objects at all". Wrong grep. `grep -cE "_frame"` returns 14: only `first` had
been forced out, `second` was still `v6_frame`, and it was still stored into a
heap array one line further down. Not a contradiction either.

Forcing *every* object out of the frame is the test that was actually decisive,
and it ends the crash. That is what confirmed the mechanism.

## What is committed, and what is not

The counter and its assertion are committed: they are an instrument, they made
the suite able to state something it could not, and the suite is green with them.

The case is committed too, in 0056 rather than here:
`tooling/memory/cases/cyclic-array` reproduces the segfault under
`NTS_RC_NAIVE` against the compiler as this record found it, and reads 8 / 4 / 0
against the compiler as 0056 leaves it. `leaked=-7` went with the fix, which is
the same bug seen from the other side, as guessed above.

The lesson this record ends on is not about the collector. Twice I ran one test,
took a single number out of it, and wrote down that the diagnosis was refuted.
Both times the number was answering a different question than the one I put to
it. A diagnosis that nothing has contradicted is worth distrusting -- and a
diagnosis contradicted by exactly one number is worth checking the number.

// expect: lacks-c nts_array_element
//
// The two array reads that still abort out of range, and why each was left.
//
// `examples/an-out-of-range-read-the-program-handles` fixed the third: a read
// the program is handling, of a slot that cannot hold the absence. That is the
// case with no other answer, and it is the one `querystring` aborted the
// process on. These two have another answer, and taking the general fix would
// have made a fast path slow to buy correctness it can get more cheaply.
//
// # `unknown[]`, whose slot can hold the absence
//
// `values[i]` where `values: unknown[]` is a load of an erased slot. Out of
// range it traps, and it should answer the `undefined` tag — which fits in the
// slot, so `ArrayGet` can *produce* it rather than call anything.
//
// Routing it through `nts_array_element` instead is correct and costs a call
// per read. `benches/cases/erasure-stored-unknown` does exactly this read
// 200,000 times in its inner loop, and the first version of the fix turned that
// load into a call. **Found by emitting the benchmark program and counting the
// calls, before any timing was run** — 1 with the wide rule, 0 with the narrow
// one. That is a stronger check than a measurement: zero calls has no error bar.
//
// # A view, whose helper asserts it is an array
//
// `nts_array_element` begins `if (!nts_is_array(array)) { ... abort(); }`, and a
// typed array is an `NtsView`. Routing one there trades an abort for a
// different abort — the same defect wearing the runtime's own refusal instead
// of the bounds one, which is worse than leaving it, because it would read as a
// proof failure rather than an out-of-range read.
//
// It wants a view-shaped helper. The cone is smaller: a typed array's length is
// nearly always the thing its loop is bounded by, where a lookup table indexed
// by a `charCodeAt` is bounded by nothing.
//
// # What this fixture guards
//
// `lacks-c nts_array_element` — that neither of the two below is routed. It
// guards the *decision*, not the defect, because a fixture cannot assert an
// abort: the process is gone before anything can read the result. The
// answer-level record for what these two do belongs in `agreements/`, which is
// the Node lane's directory and built for exactly that.
//
// **Controlled when written**, by adding the routed read from the example to
// this file and re-running:
//
//     FIXED  an-out-of-range-read-that-still-traps: the backend now emits it.
//            Expected absence of: lacks-c nts_array_element
//
// `FIXED` rather than `REGRESSED`, because for an absence form the harness
// reads presence as the blocker being resolved — which is right for a `lacks-c`
// filed against something that should stop being emitted, and reads oddly for
// one filed against something that should stay absent. Worth knowing before
// someone reads that word here and believes it.
//
// If either of these is fixed properly — `ArrayGet` answering the tag for the
// erased slot, a view helper for the other — this guard goes on holding, which
// is correct: the fix that would break it is the one that was measured and
// rejected.

const held: unknown[] = [1, "two", 3];
const view = new Int32Array(4);

/** A slot that can hold the absence, so a load is enough. */
export function erasedSlot(i: number): number {
  const v = held[i & 2];
  return typeof v === "number" ? v : -1;
}

/** A view, whose read has no helper that answers `undefined`. */
export function viewRead(i: number): number {
  const v = view[i & 3];
  return v === undefined ? -1 : v;
}

/** Control: a read that IS routed lives in the example, not here. */
export function control(n: number): number {
  return erasedSlot(n) + viewRead(n);
}

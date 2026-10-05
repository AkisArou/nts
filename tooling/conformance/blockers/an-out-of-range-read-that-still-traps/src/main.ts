// expect: lacks-c nts_array_element
//
// The array read that still aborts out of range, and why it was left.
//
// `examples/an-out-of-range-read-the-program-handles` fixed a read the program
// is handling, of a slot that cannot hold the absence. A second one, an
// `unknown[]` read, now answers `undefined`: `bounds::answer_erased_reads`
// gives what bounds elimination left checked the runtime's answer, and a read
// proven in range keeps its load -- `benches/cases/erasure-stored-unknown`
// still emits no call. The view below is what remains.
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
// `lacks-c nts_array_element` — that the view read below is not routed. It
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
// If it is fixed properly — a view-shaped helper — this guard goes on
// holding, which is correct: the fix that would break it is routing a view to
// `nts_array_element`, which asserts an array.

const view = new Int32Array(4);

/** A view, whose read has no helper that answers `undefined`. */
export function viewRead(i: number): number {
  const v = view[i & 3];
  return v === undefined ? -1 : v;
}

/** Control: a read that IS routed lives in the example, not here. */
export function control(n: number): number {
  return viewRead(n);
}

// A fixed-length view over a resizable buffer.
//
// Wrong on **every backend** from the day resizable buffers landed until
// 2026-09-18, and invisible: `examples/typed-array-aliasing` covers this area
// and printed `agreed on every case` throughout, because the disagreement is on
// an input its pool never drives. Not a declined case -- an *unreached* one,
// which is a different hole from the one the partial-comparison ceiling closes.
//
// It took two lanes: the rule is implemented twice, `runtime/c` (which serves C
// and LLVM) and `runtime/jvm`, and both had the same shape -- a tracking branch
// computed from the buffer, under a comment explaining that a stored length is
// right until the first resize and wrong afterwards, and the branch directly
// above it returning the stored length.
//
// `nts_view_length` computed the tracking case from the buffer and returned the
// stored length for a fixed one, so `tracks.length` was right and
// `tracks.subarray(0, 2).length` was not.
//
// Node's rule, measured component by component rather than inferred from a
// total: a fixed view is out of bounds when `byteOffset + length * width`
// exceeds the buffer, and an out-of-bounds view has length 0 and `undefined`
// for every element. It is a **test, not a latch** -- grow the buffer back and
// the view is in bounds again.
//
//     buffer 4 -> 0    tracks 0    cut 0    offsetCut 0
//     buffer 0 -> 8    tracks 8    cut 2    offsetCut 2
//     buffer 8 -> 3    tracks 3    cut 2    offsetCut 0
//
// `offsetCut` at offset 2 needs 4 bytes where `cut` needs 2, which is what the
// 3-byte size separates. An example with only `cut` would pass on a fix that
// tested `length` and forgot `byteOffset`.

function sized(n: number): number {
  return n > 6 ? 8 : n > 4 ? 3 : n > 2 ? 4 : 0;
}

// The three views at once, folded into one scalar.
export function lengthsAcrossAResize(n: number): number {
  const buffer = new ArrayBuffer(4, { maxByteLength: 8 });
  const tracks = new Uint8Array(buffer);
  const cut = tracks.subarray(0, 2);
  const offsetCut = new Uint8Array(buffer, 2, 2);
  buffer.resize(sized(n));
  return tracks.length * 10000 + cut.length * 100 + offsetCut.length;
}

// Out and back: the arm that fails on any fix which latches rather than tests.
export function aViewComesBackIntoBounds(n: number): number {
  const buffer = new ArrayBuffer(4, { maxByteLength: 8 });
  const cut = new Uint8Array(buffer, 0, 2);
  buffer.resize(0);
  const whileShrunk = cut.length;
  buffer.resize(sized(n));
  return whileShrunk * 100 + cut.length;
}

// The arm that is missing, and why it is an improvement that it is.
//
// `view[0]` on an out-of-bounds view is `undefined` in node. Before this fix it
// **disagreed** on 14 of 29 cases -- the stale length said the index was in
// range, so the read returned a byte of a shrunk buffer. After it, the same 14
// **decline**: the length is 0, and the read was lowered as an *asserted*
// in-range access because `view[0]` types as `number` rather than
// `number | undefined`.
//
// Silent wrong answers became honest declines, which is the direction that
// matters, and what is left is a different family -- an asserted index that was
// not in range, which node answers `undefined` for. That has its own row and
// its own several hundred declines across this corpus, and an arm here would
// only re-measure it.

// The tracking view in the same program, which was always right -- the arm that
// says this was about the fixed branch and not about resizing.
export function aTrackingViewIsUnchanged(n: number): number {
  const buffer = new ArrayBuffer(4, { maxByteLength: 8 });
  const tracks = new Uint8Array(buffer);
  buffer.resize(sized(n));
  return tracks.length;
}

// A fixed view over a **non**-resizable buffer, which can never go out of
// bounds -- the arm that fails if the new test is wrong about the ordinary case.
export function aFixedViewOverAFixedBuffer(n: number): number {
  const buffer = new ArrayBuffer(4);
  const view = new Uint8Array(buffer, 1, 2);
  view[0] = n > 0 ? 7 : 3;
  return view.length * 100 + view[0];
}

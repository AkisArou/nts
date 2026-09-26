// **A bounds check removed where it is still needed: an out-of-bounds read.** An
// array held in a field is shrunk by a closure -- `xs.length = 0`, or four
// `pop()`s, through an alias taken outside the closure -- and then read at an
// index its *original* length licensed. node answers `undefined`; nts answers 6,
// the stale element still in the buffer past the new end, read with no check.
//
// The control, the same shrink with no closure, keeps the check: the runtime
// refuses `index 5 is outside [0, 0)` (a runtime refusal, not this defect).
//
// **It needs a field allocated with a known length** (`items = [1..8]`), so that
// `lengths` has a fact to remove a check against. A field grown from `[]` (or
// assigned from a parameter) has no such fact and keeps its check -- measured:
// the same closure shrink on `items: number[] = []` pushed to eight aborts with
// `index 5 is outside [0, 0)`. A reproduction written that way sees nothing and
// looks fixed; it is not.
//
// **What the fix should make this say: CHANGED, not FIXED.** When `fields::lengths`
// stops trusting the recorded length, the check comes back and the read aborts
// (`index 5 is outside [0, 0)`) where node answers `undefined`: a *stale element
// read with no check* becomes a *refused index*. That is progress -- the silent
// divergence replaced by a loud one -- and still a divergence. Answering
// `undefined` is a separate question about the read, pinned in
// a-read-past-the-end-of-an-array-aborts.
//
// **The cause (compiler lane's reading, this fixture its witness):**
// `fields::lengths` records a `(layout, field)` as changing length only when a
// `FieldGet` of it appears directly in a call's argument list, and its answer
// feeds `bounds.rs` as `field_lengths` -- bounds-check *elimination*. The alias is
// the value of a field store into the closure's frame, never an argument, so the
// field keeps its recorded length 8 and `5 < 8` drops the check. Growth is the
// safe direction for this consumer (eight probes that pushed all agreed);
// shrinking is the dangerous one. The sibling of
// a-length-folded-past-a-closures-push: the same narrow escape question, the
// opposite soundness direction.
class Holder {
  items: number[] = [1, 2, 3, 4, 5, 6, 7, 8];
}
function afterLengthZero(): string {
  const h = new Holder();
  const xs = h.items;
  const shrink = (): void => { xs.length = 0; };
  shrink();
  return String(h.items[5]);
}
function afterPops(): string {
  const h = new Holder();
  const xs = h.items;
  const shrink = (): void => { xs.pop(); xs.pop(); xs.pop(); xs.pop(); };
  shrink();
  return String(h.items[5]);
}
observe("length=0", afterLengthZero());
observe("four pops", afterPops());
done();

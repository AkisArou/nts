// `.length` of a local array, read after a closure pushed onto it, is folded to
// the length it was *allocated* with: nts answers 0 where node answers 1. 28
// `nts check` cases in the compiler lane's reduction, pre-existing (the same on a
// binary from before 2026-09-26's commits).
//
// **The cause, diagnosed by the compiler lane:** \`hir::allocated_length_is_exact\`
// folds \`.length\` on a local \`array.new\` to its allocated size unless the array is
// handed somewhere, and it tests only the array appearing as a *call argument*.
// A closure captures by a field store into its frame -- \`field.set %frame.0 =
// %array\` -- and is then called with the frame, not the array, so the claim
// survives the push. The HIR reads \`array.len\`; the prepared program has
// \`const 0\` in its place. Look there.
//
// Four arms, each ruling out a wrong diagnosis; the first is the defect:
//   caller      the caller's own read after the closure pushed         -- wrong
//   element     a closure's element *write* is seen by the caller      -- not capture-by-copy
//   other       a second closure reading \`.length\` answers right       -- the environment is fine
//   pushedFirst the caller pushing once itself first answers right     -- another clause trips,
//                                                                          which is why it looks intermittent
// **Now a guard.** a795534a4 made `allocated_length_is_exact` a whitelist over
// every use -- an op kind it does not know loses the claim, where before it kept
// it -- and this was re-recorded as agreeing. examples/a-length-read-after-a-
// closure-pushed carries the same behaviour; this row is the second seatbelt.
function callerReads(): number {
  const seen: number[] = [];
  const push = (): void => { seen.push(1); };
  push();
  return seen.length;
}
function callerReadsElement(): number {
  const seen: number[] = [7];
  const write = (): void => { seen[0] = 9; };
  write();
  return seen[0]!;
}
function otherClosureReads(): number {
  const seen: number[] = [];
  const push = (): void => { seen.push(1); };
  const size = (): number => seen.length;
  push();
  return size();
}
function callerPushedFirst(): number {
  const seen: number[] = [];
  seen.push(1);
  const push = (): void => { seen.push(2); };
  push();
  return seen.length;
}
observe("caller", String(callerReads()));
observe("element", String(callerReadsElement()));
observe("other", String(otherClosureReads()));
observe("pushedFirst", String(callerPushedFirst()));
done();

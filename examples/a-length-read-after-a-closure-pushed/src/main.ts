// `.length` on a local array is folded to the size it was allocated with, which
// is what lets an index into a literal be proven in bounds without a check. The
// claim is supposed to lapse the moment the array is handed anywhere -- and the
// test for "handed anywhere" was `OpKind::Call { args }`, a call *argument*.
//
// A closure captures by storing into its frame, so the array is the value of a
// field store and the call's argument is the frame. The escape was invisible,
// the claim survived a `push` the closure made, and `seen.length` answered the
// allocated size for the rest of the function.
//
// Four of these five arms were already correct, and each one kills a different
// wrong diagnosis: the array is shared rather than copied, the closure's own view
// is right, and a push by the caller repairs it. Keeping them is what says the
// fix narrowed the claim rather than removing it.

/**
 * **The subject.** Answered 0 before, where node answers 1.
 */
export function callerReads(x: number): number {
  const seen: number[] = [];
  const push = (): void => {
    seen.push(1);
  };
  push();
  return seen.length + x * 0;
}

/**
 * **Control.** A *second* closure reads the length and was always right, so the
 * frame's view of the array is correct and it is the caller's read that was
 * folded.
 */
export function otherClosureReads(x: number): number {
  const seen: number[] = [];
  const push = (): void => {
    seen.push(1);
  };
  const size = (): number => seen.length;
  push();
  return size() + x * 0;
}

/**
 * **Control.** An element *write* from the closure was always visible to the
 * caller, which is what rules out capture-by-copy: the array is one object.
 */
export function callerReadsElement(x: number): number {
  const seen: number[] = [7];
  const write = (): void => {
    seen[0] = 9;
  };
  write();
  return seen[0]! + x * 0;
}

/**
 * **Control.** The caller pushing once itself was always right, because a push in
 * the same function trips the store clause instead. This is why the defect looked
 * intermittent.
 */
export function callerPushedFirst(x: number): number {
  const seen: number[] = [];
  seen.push(1);
  const push = (): void => {
    seen.push(2);
  };
  push();
  return seen.length + x * 0;
}

/** **Control.** No closure at all. */
export function noClosure(x: number): number {
  const seen: number[] = [];
  seen.push(1);
  return seen.length + x * 0;
}

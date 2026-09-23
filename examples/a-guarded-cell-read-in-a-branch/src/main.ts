// A closure reading a `const` declared **below** it is captured by reference --
// a cell -- and a read of a cell inside a closure is *guarded*, because the
// body may run before the declaration has given the cell its value. The LLVM
// backend writes that guard as two labels opened inline:
//
//     br i1 %v11.is, label %v11.ok, label %v11.no
//     v11.no:  call void @nts_cell_unready(...)
//              br label %v11.ok
//     v11.ok:
//
// So the block's terminator ends up in `%v11.ok` while the block is still
// named `%b1` -- and a `phi` in the successor said `[ %v15, %b1 ]`, naming a
// block that is no longer the predecessor. clang rejected the whole module:
//
//     error: invalid LLVM IR input: PHI node entries do not match predecessors!
//
// A hard failure rather than a wrong answer, and reachable with nothing exotic:
// the guard has to be *inside a branch* so the value needs a phi at all, which
// is why `forwardInATernary` puts the call in a `?:` and `forwardStraightLine`
// does not. The second lowered on the broken compiler and is the control that
// says the guard alone was never the problem.

/**
 * Under test: a guarded cell read inside a `?:`, so its value needs a `phi`.
 *
 * Refused by clang on the pre-change binary; the C and JVM backends compiled
 * and agreed with node throughout, which is why nothing caught it -- see
 * `docs/records` on the JVM lane being the type-confusion oracle. Here it is
 * LLVM that is alone in looking.
 */
export function forwardInATernary(n: number): number {
  let seen = 0;
  const onListening = (k: number): number => {
    seen += 1;
    return seen === 1 ? cleanup(k) : k;
  };
  const cleanup = (k: number): number => k * 2;
  return onListening(n);
}

/**
 * Control: the same forward capture with no branch, which lowered on every
 * backend before the fix. If this one ever fails, the cause is the cell rather
 * than the phi bookkeeping.
 */
export function forwardStraightLine(n: number): number {
  let seen = 0;
  const onListening = (k: number): number => {
    seen += 1;
    return cleanup(k) + seen;
  };
  const cleanup = (k: number): number => k * 2;
  return onListening(n);
}

/**
 * Control: two guarded reads in *both* arms, so each arm's edge leaves from a
 * different `.ok` label. One exit label per block is not enough if a block can
 * carry two guards; this is the arm that says which.
 */
export function guardsInBothArms(n: number): number {
  let seen = 0;
  const pick = (k: number): number => {
    seen += 1;
    return k > 0 ? low(k) : high(k);
  };
  const low = (k: number): number => k + 1;
  const high = (k: number): number => k - 1;
  return pick(n) + seen;
}

/** Control: an ordinary `?:` with no cell at all. */
export function noCell(n: number): number {
  return n > 0 ? n * 2 : n - 1;
}

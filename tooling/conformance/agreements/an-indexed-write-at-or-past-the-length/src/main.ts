// A write **past** an array's length aborts the process. A write *at* the
// length -- the ordinary append -- is correct.
//
//     xs[3] = 4   on a one-element array   aborts, node gives length 4
//     xs[1] = 2   at exactly the length    answers 2, agreeing with node
//     xs.push(2)                           answers 2, agreeing with node
//     xs[1] = 5   inside the bounds        agrees
//
// **Corrected 2026-09-09.** This file first read `xs[1] = 2` as aborting too,
// and said the ordinary append was broken. It was, on the pin measured at the
// time, and it is not now -- one of that afternoon's compiler changes closed
// it. The claim is left in this comment rather than deleted, because the file
// was sent to the compiler lane with "the ordinary append aborts" as its
// headline and that is no longer true.
//
// # What is left is a documented representation limit, not a defect
//
// `nts_array_grow_slot` handles `index == length` by reserving and extending,
// which is why the append works. Past that it calls `nts_bounds`, and its own
// comment says why:
//
//     Out of range, or sparse, or not a whole number … the sparse case is
//     refused here rather than [handled] because a dense array cannot hold a
//     hole.
//
// So the refusal is deliberate and the reason is real. What is left to decide
// is only **how** it refuses: `nts: refused: index 3 is outside [0, 1)` is an
// abort, not a thrown error a program could catch and not a compile-time
// refusal a `blockers/` fixture would see. The program compiles, runs, and
// dies.
//
// Kept as a case because node grows the array and this does not, so the two
// disagree whatever the reason -- and because a representation limit that
// aborts at runtime is worth telling apart from one that refuses at compile
// time.
//
// Found by a sweep of eight unrelated ordering and method questions, none of
// which was about bounds. The case is kept here rather than in `blockers/`
// because there is nothing to refuse: `emit-c` is happy, clang is happy, the
// addon loads, and the answer arrives as a signal.

/** Node: 4. */
export function writePastTheEnd(): number {
  const xs: number[] = [1];
  xs[3] = 4;
  return xs.length;
}

/** Node: 2. The ordinary append. */
export function writeAtTheLength(): number {
  const xs: number[] = [1];
  xs[1] = 2;
  return xs.length;
}

/** Control: the other spelling of append, which agrees. */
export function pushInstead(): number {
  const xs: number[] = [1];
  xs.push(2);
  return xs.length;
}

/** Control: a write inside the bounds, which agrees. */
export function writeInsideTheBounds(): number {
  const xs: number[] = [1, 2];
  xs[1] = 5;
  return xs[1] ?? -1;
}

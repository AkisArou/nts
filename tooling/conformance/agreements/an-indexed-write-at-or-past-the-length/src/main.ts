// A write **past** an array's length aborts the process. A write *at* the
// length -- the ordinary append -- is correct.
//
//     xs[3] = 4   on a one-element array   aborts, node gives length 4
//     xs[1] = 2   at exactly the length    answers 2, agreeing with node
//     xs.push(2)                           answers 2, agreeing with node
//     xs[1] = 5   inside the bounds        agrees
//
// **Corrected twice on 2026-09-09, and the second correction is the one to
// read.** This file first said `xs[1] = 2` aborts. Then a later pin answered 2,
// so it was rewritten to say the append had been fixed and only the sparse
// write remained. **That was wrong: the append is not fixed on HEAD.**
//
// The pin was a copy of `target/release/nts`, which is built by whichever
// session last ran a build **from its own working tree**. It contained the
// compiler lane's in-progress array work, which they had not landed and which
// their own memory floor was rejecting.
//
// Verified rather than taken: the same program answers `nts: refused: index 1
// is outside [0, 1)` on a pin taken at 21:00 and `2` on one taken at 21:35, and
// the only two commits in that window are `27ac7390` and `78d69869` -- one
// about `super.fill` reaching the runtime, the other about a literal's
// contextual member. Neither touches array growth. So the difference came from
// something not in the history, which is the definition of a working tree.
//
// **A pin gives stability, not provenance.** Copying the binary stops it
// changing under a measurement; it does not make the measurement about a
// commit. To speak about HEAD, the binary has to be built from HEAD -- and this
// lane may not run `cargo`, so the honest form is to say which pin a number
// came from and when it was taken.
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

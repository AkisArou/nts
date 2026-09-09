// An indexed write at or past an array's length aborts the process.
//
//     nts: refused: index 3 is outside [0, 1)
//
// In JavaScript `xs[xs.length] = v` **is** the append, and `xs[3] = v` on a
// one-element array gives a length of 4. Here both call a bounds check that
// aborts -- not a thrown error a program could catch, and not a compile-time
// refusal a fixture in `blockers/` would see. The program compiles, runs, and
// dies.
//
// Three controls:
//
//     xs[3] = 4   on a one-element array   aborts, node gives length 4
//     xs[1] = 2   at exactly the length    aborts, node gives length 2
//     xs.push(2)                           answers 2, agreeing with node
//
// The second row is the one that matters. Writing *at* the length is the
// ordinary way to append in JavaScript and in much of node's own source, so
// this is not an exotic input -- it is one of the two spellings of append, and
// the other one works.
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

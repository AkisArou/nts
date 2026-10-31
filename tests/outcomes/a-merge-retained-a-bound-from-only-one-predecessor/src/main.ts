// Regression guard: join absent predecessor refinements with the global fact.
// Fix: 120cb245238de14e37477becbd9b8abd1ba1527c.
// run: check
// The sole subject/control difference swaps the equivalent if arms.
// A code-unit read makes the stale range observable as a lost NaN.
// The XOR permutation keeps the complete 0..7 range while the unrefined
// control-flow arm can reach past the four-unit string.
// The arm that tests `j` is lowered first, so its edge reaches the merge
// first; the other arm has its own branch, so its edge arrives later.
export function subject(c: boolean, d: boolean, i: number): number {
  const j = ((i | 0) ^ 4) & 7;
  let noise = 0;
  if (c) {
    if (j > 3) {
      return -100;
    }
    if (j < 0) {
      return -200;
    }
  } else {
    if (d) {
      noise = 1;
    }
  }
  return "abcd".charCodeAt(j) + noise;
}

// Control: the same program with the arms swapped, so the arm that never
// tests `j` reaches the merge first.
export function control(c: boolean, d: boolean, i: number): number {
  const j = ((i | 0) ^ 4) & 7;
  let noise = 0;
  if (!c) {
    if (d) {
      noise = 1;
    }
  } else {
    if (j > 3) {
      return -100;
    }
    if (j < 0) {
      return -200;
    }
  }
  return "abcd".charCodeAt(j) + noise;
}

// run: check
// The sole subject/control difference swaps the equivalent if arms.
// A scalar observation isolates the merge from the separate undefined-element boundary.
// The arm that tests `j` is lowered first, so its edge reaches the merge
// first; the other arm has its own branch, so its edge arrives later.
export function subject(c: boolean, d: boolean, i: number): number {
  const j = i | 0;
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
  return (j <= 3 ? 1000 : 2000) + noise;
}

// Control: the same program with the arms swapped, so the arm that never
// tests `j` reaches the merge first.
export function control(c: boolean, d: boolean, i: number): number {
  const j = i | 0;
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
  return (j <= 3 ? 1000 : 2000) + noise;
}

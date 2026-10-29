// The arm that tests `j` is lowered first, so its edge reaches the merge
// first; the other arm has its own branch, so its edge arrives later.
export function subjectAccess(c: boolean, d: boolean, i: number): number {
  const xs = [10, 20, 30, 40];
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
  const v: number | undefined = xs[j];
  return (j <= 3 ? 1000 : 2000) + (v === undefined ? -1 : v) + noise;
}

// Control: the same program with the arms swapped, so the arm that never
// tests `j` reaches the merge first.
export function controlAccess(c: boolean, d: boolean, i: number): number {
  const xs = [10, 20, 30, 40];
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
  const v: number | undefined = xs[j];
  return (j <= 3 ? 1000 : 2000) + (v === undefined ? -1 : v) + noise;
}

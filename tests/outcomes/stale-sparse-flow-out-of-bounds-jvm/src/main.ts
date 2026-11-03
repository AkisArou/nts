// backend: jvm

// run: check

// The stale global count at the merge can erase the runtime bounds check for
// table[i]. The in-range control changes only how i is formed.
export function pick(x: number, m: number): number {
  const i = x | 0;
  const mm = m > 20 ? 20 : m;
  let n = 2;
  for (let k = 0; k < mm; k++) n++;
  const ok = i < n;
  let bias = 0;
  if (x > 100) bias = 1;
  const table = [10, 20];
  if (ok && i >= 0) return table[i] + bias;
  return -1;
}

export function pickInRangeControl(x: number, m: number): number {
  const i = (x | 0) & 1;
  const mm = m > 20 ? 20 : m;
  let n = 2;
  for (let k = 0; k < mm; k++) n++;
  const ok = i < n;
  let bias = 0;
  if (x > 100) bias = 1;
  const table = [10, 20];
  if (ok && i >= 0) return table[i] + bias;
  return -1;
}

// A function that only forwards its parameter lets go of whatever the function
// it forwards to lets go of.
//
// `keepInner` keeps a field of what it is given, and escape analysis publishes
// that: its callers must not confine what they put in that field. `forward`
// reads no field of `b` -- it passes `b` on -- and published nothing, so
// `make` put both the `Box` and the `Inner` inside it in its frame, and
// `kept` held a pointer into a dead frame. Two calls in a row reuse that frame,
// so the first kept value read the second one's: one more than node's answer.
//
// `keptTwoLevelsIn` is the same one level deeper: `keepInner` reads `b.inner`
// and forwards *that* to a function keeping a field of it.
//
// The control is `keepInner` called from `make` directly, which reads the
// field in the function the caller calls and was always right.

interface Deep {
  v: number;
}

interface Inner {
  v: number;
  deep: Deep;
}

interface Box {
  inner: Inner;
}

// Overwritten rather than appended, so the live set is constant: `rc.sh` reads
// growth between cases as a leak.
const inners: Inner[] = [{ v: 0, deep: { v: 0 } }, { v: 0, deep: { v: 0 } }];
const deeps: Deep[] = [{ v: 0 }, { v: 0 }];
let next = 0;

function keepInner(b: Box): void {
  inners[next] = b.inner;
  next = 1 - next;
}

function keepDeep(i: Inner): void {
  deeps[next] = i.deep;
  next = 1 - next;
}

function keepDeepOf(b: Box): void {
  keepDeep(b.inner);
}

// Recursive so it is not inlined: inlining puts the read back in `make`.
function forward(b: Box, depth: number, keep: boolean): void {
  if (depth > 0) forward(b, depth - 1, keep);
  else if (keep) keepInner(b);
  else keepDeepOf(b);
}

function make(n: number, keep: boolean): void {
  const b: Box = { inner: { v: n, deep: { v: n * 2 } } };
  forward(b, 2, keep);
}

export function keptThroughAForward(n: number): number {
  next = 0;
  make(n, true);
  make(n + 1, true);
  return inners[0].v;
}

export function keptTwoLevelsIn(n: number): number {
  next = 0;
  make(n, false);
  make(n + 1, false);
  return deeps[0].v;
}

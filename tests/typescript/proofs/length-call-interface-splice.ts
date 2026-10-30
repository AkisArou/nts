/*---
description: An interface call can shorten the allocation whose length its caller reads.
features: [ts-proof-length, ts-route-call, ts-functions, ts-iteration, ts-arrays, ts-interfaces, ts-class]
---*/
// Fact: the literal has length 4 (docs/foundations/objects.md, Arrays).
// Route: one dispatched implementation splices; node reads min(n, 4).
interface Trimmer { trim(xs: number[], n: number): void; }
class Keep implements Trimmer {
  trim(xs: number[], n: number): void { xs[0] = n; }
}
class Cut implements Trimmer {
  trim(xs: number[], n: number): void { xs.splice(n); }
}
function lengthAfterDispatch(n: number, remove: boolean): number {
  const worker: Trimmer = remove ? new Cut() : new Keep();
  const xs = [10, 20, 30, 40];
  worker.trim(xs, n);
  return xs.length;
}
for (const n of [0, 1, 3, 4, 7]) {
  assert.sameValue(lengthAfterDispatch(n, false), 4);
  assert.sameValue(lengthAfterDispatch(n, true), n < 4 ? n : 4);
}

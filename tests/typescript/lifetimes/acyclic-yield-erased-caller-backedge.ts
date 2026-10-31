/*---
description: A yielded object gains an unknown self-edge while its generator is suspended.
features: [ts-lifetime-acyclic, ts-route-yield, ts-functions, ts-iteration, ts-class, ts-unknown, ts-arrays, ts-generators]
---*/
// Fact: acyclic types skip collection (docs/foundations/memory.md, Where nts stands).
// Route: the caller closes the yielded local into a cycle; Node resumes with the same complete object.
// Node checks live edges; unreachable cycles are left intact for the steady-heap check.
class Cell {
  id: number; text: string; edge: unknown = null;
  constructor(n: number) { this.id = n; this.text = "cell:" + n; }
}
function check(value: Cell, n: number): void {
  assert.sameValue(value.id, n); assert.sameValue(value.text, "cell:" + n);
  assert.sameValue(value.text.length, ("cell:" + n).length);
}
function churn(n: number): void {
  const all: Cell[] = [];
  for (let i = 0; i < 24; i++) all.push(new Cell(n + i + 1000));
  for (let i = 0; i < all.length; i++) { check(all[i], n + i + 1000); assert.sameValue(all[i].edge, null); }
}

function* hold(n: number): Generator<Cell, Cell, unknown> {
  const value = new Cell(n);
  yield value;
  return value;
}
for (let n = 0; n < 240; n++) {
  const reader = hold(n);
  const first = reader.next();
  if (first.done) throw new Error("missing yield");
  first.value.edge = first.value;
  churn(n);
  const done = reader.next();
  if (!done.done) throw new Error("not complete");
  assert.sameValue(done.value === first.value, true);
  check(done.value, n);
  assert.sameValue(done.value.edge === first.value, true);
}

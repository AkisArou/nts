/*---
description: Returning a captured object twice from map cannot move the same reference into both results.
features: [ts-lifetime-move, ts-route-callback, ts-functions, ts-iteration, ts-arrays, ts-strings, ts-objects, ts-closures]
---*/
// Fact: a last-use handoff moves its count (docs/foundations/memory.md, "Where nts stands").
// Route: map keeps two callback results after its closure dies; Node preserves the shared object identity.
type Cell = { id: number; text: string };
function make(id: number): Cell { return { id, text: "cell/" + id }; }
function churn(seed: number): void {
  const rows: Cell[] = [];
  for (let i = 0; i < 24; i++) rows.push(make(seed + 1000 + i));
  let sum = 0;
  for (const row of rows) sum += row.id + row.text.length;
  assert.sameValue(sum, 24 * (seed + 1000) + 492);
}
function check(value: Cell, same: Cell, n: number): void {
  assert.sameValue(value === same, true);
  assert.sameValue(value.id, n);
  assert.sameValue(value.text, "cell/" + n);
  assert.sameValue(value.text.length, ("cell/" + n).length);
}
function prepare(n: number): Cell[] {
  const item = make(n);
  return [0, 1].map(() => item);
}
for (let n = 0; n < 256; n++) {
  const saved = prepare(n);
  churn(n);
  assert.sameValue(saved.length, 2);
  check(saved[0], saved[1], n);
}

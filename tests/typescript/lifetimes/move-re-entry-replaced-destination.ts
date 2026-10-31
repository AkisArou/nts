/*---
description: A re-entrant callback can destroy a moved destination while outer aliases stay live.
features: [ts-lifetime-move, ts-route-re-entry, ts-functions, ts-iteration, ts-arrays, ts-strings, ts-objects, ts-closures]
---*/
// Fact: a last-use handoff moves its count (docs/foundations/memory.md, "Where nts stands").
// Route: re-entry replaces the handoff slot before the outer aliases are read; Node preserves each invocation.
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
function run(n: number, depth: number, destination: { item: Cell }): void {
  const item = make(n);
  const kept = item, same = item;
  destination.item = item;
  if (depth > 0) {
    const again = (): void => run(n + 500, depth - 1, destination);
    again();
  }
  destination.item = make(-1);
  churn(n);
  check(kept, same, n);
}
for (let n = 0; n < 256; n++) run(n, 1, { item: make(-1) });

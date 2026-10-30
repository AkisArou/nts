/*---
description: A conditional write changes the captured binding observed after the join.
features: [ts-proof-capture, ts-route-merge, ts-functions, ts-iteration, ts-closures]
---*/
// Fact: an unwritten capture may be copied (docs/foundations/objects.md, Functions as values).
// Route: one branch writes after capture; node reads the selected latest binding.
function afterJoin(n: number): number {
  let value = 0;
  const read = (): number => value;
  if (n > 0) value = n;
  return read();
}
for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(afterJoin(n), n > 0 ? n : 0);
}

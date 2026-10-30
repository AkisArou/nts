/*---
description: Loop back edges update a captured binding declared outside the loop.
features: [ts-proof-capture, ts-route-loop, ts-functions, ts-iteration, ts-closures]
---*/
// Fact: an unwritten capture may be copied (docs/foundations/objects.md, Functions as values).
// Route: the loop writes an outer binding; node sees each preceding write and the final n.
function afterLoop(turns: number): number {
  let value = 0;
  const read = (): number => value;
  let result = 0;
  for (let i = 0; i < turns; i++) {
    result = read();
    value = i + 1;
  }
  return result + read();
}
for (const n of [0, 1, 2, 3, 7]) {
  assert.sameValue(afterLoop(n), n === 0 ? 0 : 2 * n - 1);
}

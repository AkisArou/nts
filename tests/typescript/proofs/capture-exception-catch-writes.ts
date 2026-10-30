/*---
description: A catch block updates the binding shared with a reader created before the try.
features: [ts-proof-capture, ts-route-exception, ts-functions, ts-iteration, ts-closures, ts-errors]
---*/
// Fact: an unwritten capture may be copied (docs/foundations/objects.md, Functions as values).
// Route: the exception edge writes the captured binding; node sees that write after the join.
function afterCatch(n: number): number {
  let value = 0;
  const read = (): number => value;
  try {
    if (n > 0) throw new Error("write in catch");
  } catch {
    value = n;
  }
  return read();
}
for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(afterCatch(n), n > 0 ? n : 0);
}

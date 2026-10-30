/*---
description: A finally block writes the binding held by an earlier reader on normal and caught paths.
features: [ts-proof-capture, ts-route-exception, ts-functions, ts-iteration, ts-closures, ts-errors]
---*/
// Fact: an unwritten capture may be copied (docs/foundations/objects.md, Functions as values).
// Route: finally writes the captured local on either edge; node reads the current n.
function afterFinally(n: number): number {
  let value = 0;
  const read = (): number => value;
  try {
    if (n > 0) throw new Error("unwind");
  } catch {
  } finally {
    value = n;
  }
  return read();
}
for (const n of [-1, 0, 1, 3, 7]) assert.sameValue(afterFinally(n), n);

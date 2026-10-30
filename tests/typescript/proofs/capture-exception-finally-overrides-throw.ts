/*---
description: A finally write survives when that block replaces the thrown exception.
features: [ts-proof-capture, ts-route-exception, ts-functions, ts-iteration, ts-closures, ts-errors]
---*/
// Fact: an unwritten capture may be copied (docs/foundations/objects.md, Functions as values).
// Route: finally writes before replacing the throw; node preserves the binding update.
function afterThrow(n: number): number {
  let value = 0;
  const read = (): number => value;
  assert.throws(RangeError, () => {
    try { throw new Error("original"); }
    finally {
      value = n;
      throw new RangeError("replacement");
    }
  });
  return read();
}
for (const n of [-1, 0, 1, 3, 7]) assert.sameValue(afterThrow(n), n);

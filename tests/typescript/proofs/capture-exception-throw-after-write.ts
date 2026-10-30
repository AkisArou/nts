/*---
description: A throw after a captured write leaves that write visible when restoration is skipped.
features: [ts-proof-capture, ts-route-exception, ts-functions, ts-iteration, ts-closures, ts-errors]
---*/
// Fact: an unwritten capture may be copied (docs/foundations/objects.md, Functions as values).
// Route: a caught throw skips the reset after writing; node reads the latest binding.
function afterThrow(n: number): number {
  let value = 0;
  const read = (): number => value;
  try {
    value = n;
    if (n > 0) throw new Error("skip reset");
    value = -1;
  } catch {}
  return read();
}
for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(afterThrow(n), n > 0 ? n : -1);
}

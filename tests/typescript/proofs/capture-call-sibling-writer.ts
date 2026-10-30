/*---
description: A sibling writer and reader share the captured numeric binding.
features: [ts-proof-capture, ts-route-call, ts-functions, ts-iteration, ts-closures]
---*/
// Fact: an unwritten capture may be copied (docs/foundations/objects.md, Functions as values).
// Route: the sibling closure writes after read is created; node returns the latest value.
function afterWrite(n: number): number {
  let value = 0;
  const read = (): number => value;
  const write = (): void => { if (n > 0) value = n; };
  write();
  return read();
}
for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(afterWrite(n), n > 0 ? n : 0);
}

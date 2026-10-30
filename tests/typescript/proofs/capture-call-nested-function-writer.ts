/*---
description: A nested function declaration writes the binding held by an earlier reader.
features: [ts-proof-capture, ts-route-call, ts-functions, ts-iteration, ts-closures]
---*/
// Fact: an unwritten capture may be copied (docs/foundations/objects.md, Functions as values).
// Route: the nested call reaches a binding assignment; node returns n rather than copied zero.
function afterWrite(n: number): number {
  let value = 0;
  const read = (): number => value;
  function write(): void { value = n; }
  function invoke(): void { write(); }
  invoke();
  return read();
}
for (const n of [-1, 0, 1, 3, 7]) assert.sameValue(afterWrite(n), n);

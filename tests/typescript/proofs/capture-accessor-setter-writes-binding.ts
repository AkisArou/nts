/*---
description: A setter writes the captured outer binding before its reader is called.
features: [ts-proof-capture, ts-route-accessor, ts-functions, ts-iteration, ts-closures, ts-accessors, ts-objects]
---*/
// Fact: an unwritten capture may be copied (docs/foundations/objects.md, Functions as values).
// Route: the setter assigns the captured local itself; node returns n rather than copied zero.
function afterSetter(n: number): number {
  let value = 0;
  const read = (): number => value;
  const hook = { set next(next: number) { value = next; } };
  hook.next = n;
  return read();
}
for (const n of [-1, 0, 1, 3, 7]) assert.sameValue(afterSetter(n), n);

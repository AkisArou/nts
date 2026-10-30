/*---
description: A recursive nested function writes the binding shared with its sibling reader.
features: [ts-proof-capture, ts-route-call, ts-functions, ts-iteration, ts-closures]
---*/
// Fact: an unwritten capture may be copied (docs/foundations/objects.md, Functions as values).
// Route: the recursion base assigns the captured binding; node sees its latest value.
function afterWrite(n: number): number {
  let value = 0;
  const read = (): number => value;
  function write(depth: number): void {
    if (depth <= 0) { value = n; return; }
    write(depth - 1);
  }
  write(n > 0 ? n : 0);
  return read();
}
for (const n of [-1, 0, 1, 3, 7]) assert.sameValue(afterWrite(n), n);

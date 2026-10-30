/*---
description: Two intermediate closure factories preserve the writer and reader shared binding.
features: [ts-proof-capture, ts-route-call, ts-functions, ts-iteration, ts-closures, ts-function-types, ts-objects]
---*/
// Fact: an unwritten capture may be copied (docs/foundations/objects.md, Functions as values).
// Route: two factories return a binding writer; node reads its update after both frames return.
function make(n: number) {
  let value = 0;
  const read = (): number => value;
  const outer = (): (() => void) => {
    const inner = (): (() => void) => () => { value = n; };
    return inner();
  };
  return { read, write: outer() };
}
for (const n of [-1, 0, 1, 3, 7]) {
  const pair = make(n);
  pair.write();
  assert.sameValue(pair.read(), n);
}

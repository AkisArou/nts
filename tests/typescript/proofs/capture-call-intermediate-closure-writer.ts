/*---
description: A writer built through an intermediate closure shares the escaped reader binding.
features: [ts-proof-capture, ts-route-call, ts-functions, ts-iteration, ts-closures, ts-objects, ts-function-types]
---*/
// Fact: an unwritten capture may be copied (docs/foundations/objects.md, Functions as values).
// Route: the returned inner writer updates the escaped reader cell; node sees n.
function make(n: number) {
  let value = 0;
  const read = (): number => value;
  const build = (): (() => void) => () => { value = n; };
  return { read, write: build() };
}
for (const n of [-1, 0, 1, 3, 7]) {
  const pair = make(n);
  assert.sameValue(pair.read(), 0);
  pair.write();
  assert.sameValue(pair.read(), n);
}

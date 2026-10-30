/*---
description: A sibling view exposes a buffer alias that changes the tracking view length.
features: [ts-proof-length, ts-route-alias, ts-functions, ts-iteration, ts-arrays, ts-numbers]
---*/
// Fact: the tracking view has length 4 (docs/foundations/objects.md, Typed arrays).
// Route: a sibling exposes its buffer alias; node reads n after resizing.
function lengthThroughSibling(n: number): number {
  const buffer = new ArrayBuffer(8, { maxByteLength: 16 });
  const sibling = new Uint8Array(buffer);
  const alias = sibling.buffer;
  const view = new Uint16Array(buffer);
  alias.resize(n * 2);
  return view.length;
}
for (const n of [0, 1, 3, 4, 7]) {
  assert.sameValue(lengthThroughSibling(n), n);
}

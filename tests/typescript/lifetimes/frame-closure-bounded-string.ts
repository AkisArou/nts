/*---
description: A delayed reader preserves a bounded string after later calls reuse the producer.
features: [ts-lifetime-frame, ts-route-closure, ts-functions, ts-iteration, ts-closures, ts-strings]
---*/
// Fact: local allocations fit a frame (docs/foundations/memory.md, The ladder of homes).
// Route: a returned closure retains a one-unit string; node reads the original letter and length.
function prepare(n: number): () => string {
  const text = String.fromCharCode(65 + n % 26);
  assert.sameValue(text.length, 1);
  return () => text;
}
for (let n = 0; n < 240; n++) {
  const read = prepare(n);
  for (let j = 1; j <= 16; j++) {
    const busy = prepare(n + j);
    assert.sameValue(busy(), "ABCDEFGHIJKLMNOPQRSTUVWXYZ".charAt((n + j) % 26));
  }
  const text = read();
  assert.sameValue(text, "ABCDEFGHIJKLMNOPQRSTUVWXYZ".charAt(n % 26));
  assert.sameValue(text.length, 1);
}

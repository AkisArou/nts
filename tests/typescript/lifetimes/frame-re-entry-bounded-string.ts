/*---
description: Reentry does not overwrite a bounded string still used by the active call.
features: [ts-lifetime-frame, ts-route-re-entry, ts-functions, ts-iteration, ts-closures, ts-function-types, ts-strings]
---*/
// Fact: local allocations fit a frame (docs/foundations/memory.md, The ladder of homes).
// Route: a callback re-enters the producer before its local read; node preserves the outer slice.
function visit(n: number, callback: () => void): number {
  const start = n % 20;
  const text = "abcdefghijklmnopqrstuvwxyz".slice(start, start + 3);
  callback();
  assert.sameValue(text, String.fromCharCode(97 + start, 98 + start, 99 + start));
  assert.sameValue(text.length, 3);
  return text.charCodeAt(0);
}
for (let n = 0; n < 240; n++) {
  const firstCode = visit(n, () => {
    for (let j = 1; j <= 16; j++) {
      const busy = visit(n + j, () => {});
      assert.sameValue(busy, 97 + (n + j) % 20);
    }
  });
  assert.sameValue(firstCode, 97 + n % 20);
}

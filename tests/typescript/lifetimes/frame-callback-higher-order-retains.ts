/*---
description: A program callback saves a bounded string after the producer returns.
features: [ts-lifetime-frame, ts-route-callback, ts-functions, ts-iteration, ts-closures, ts-function-types, ts-arrays, ts-strings]
---*/
// Fact: local allocations fit a frame (docs/foundations/memory.md, The ladder of homes).
// Route: a higher-order call retains its argument through a callback; node keeps the original unit.
function visit(text: string, callback: (value: string) => void): number {
  callback(text);
  return text.charCodeAt(0);
}
function prepare(n: number, out: string[]): number {
  const text = String.fromCharCode(65 + n % 26);
  return visit(text, value => { out.push(value); });
}
for (let n = 0; n < 240; n++) {
  const kept: string[] = [];
  assert.sameValue(prepare(n, kept), 65 + n % 26);
  for (let j = 1; j <= 16; j++) assert.sameValue(prepare(n + j, []), 65 + (n + j) % 26);
  assert.sameValue(kept.length, 1);
  assert.sameValue(kept[0], "ABCDEFGHIJKLMNOPQRSTUVWXYZ".charAt(n % 26));
  assert.sameValue(kept[0].length, 1);
}

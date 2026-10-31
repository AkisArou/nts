/*---
description: A static field retains a bounded slice after its producer returns.
features: [ts-lifetime-frame, ts-route-global, ts-functions, ts-iteration, ts-class, ts-class-fields, ts-static, ts-strings]
---*/
// Fact: local allocations fit a frame (docs/foundations/memory.md, The ladder of homes).
// Route: a static store retains a three-unit slice; node keeps its exact text through later calls.
class Saved { static text: string = ""; }
function prepare(n: number, keep: boolean): number {
  const start = n % 20;
  const text = "abcdefghijklmnopqrstuvwxyz".slice(start, start + 3);
  if (keep) Saved.text = text;
  return text.charCodeAt(0);
}
for (let n = 0; n < 240; n++) {
  assert.sameValue(prepare(n, true), 97 + n % 20);
  for (let j = 1; j <= 16; j++) {
    assert.sameValue(prepare(n + j, false), 97 + (n + j) % 20);
  }
  const start = n % 20;
  const expected = String.fromCharCode(97 + start, 98 + start, 99 + start);
  assert.sameValue(Saved.text, expected);
  assert.sameValue(Saved.text.length, 3);
  Saved.text = "";
}

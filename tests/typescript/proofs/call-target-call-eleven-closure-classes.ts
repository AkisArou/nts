/*---
description: Eleven different closure classes retain their targets through the same callee.
features: [ts-proof-call-target, ts-route-call, ts-functions, ts-iteration, ts-closures, ts-function-types]
---*/
// Fact: known receiver or closure classes allow direct calls (docs/foundations/objects.md, Calls).
// Route: later call sites introduce eleven closure classes; node returns each distinct captured result.
function invoke(action: () => number): number { return action(); }
function check(n: number): void {
  assert.sameValue(invoke(() => n + 1), n + 1);
  assert.sameValue(invoke(() => n + 2), n + 2);
  assert.sameValue(invoke(() => n + 3), n + 3);
  assert.sameValue(invoke(() => n + 4), n + 4);
  assert.sameValue(invoke(() => n + 5), n + 5);
  assert.sameValue(invoke(() => n + 6), n + 6);
  assert.sameValue(invoke(() => n + 7), n + 7);
  assert.sameValue(invoke(() => n + 8), n + 8);
  assert.sameValue(invoke(() => n + 9), n + 9);
  assert.sameValue(invoke(() => n + 10), n + 10);
  assert.sameValue(invoke(() => n + 11), n + 11);
}
for (const n of [-1, 0, 1, 3, 7]) check(n);

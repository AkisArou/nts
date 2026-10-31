/*---
description: Implicit valueOf calls retain bounded strings from successive loop iterations.
features: [ts-lifetime-slot, ts-route-hook, ts-functions, ts-strings, ts-to-primitive, ts-conversions, ts-closures, ts-arrays, ts-objects]
---*/
// Fact: loop instances may share a frame slot only if disjoint (docs/foundations/memory.md, Where nts stands).
// Route: numeric conversion stores each captured string before the site runs again. Node preserves every retained iteration.
function check(text: string, id: number): void {
  assert.sameValue(text, String.fromCharCode(65 + id % 26, 97 + id % 26));
  assert.sameValue(text.length, 2);
}
function make(n: number): string[] {
  const saved: string[] = [];
  for (let i = 0; i < 6; i++) {
    const id = n * 8 + i;
    const text = String.fromCharCode(65 + id % 26) + String.fromCharCode(97 + id % 26);
    assert.sameValue(text.length, 2);
    const hook = { valueOf(): number { saved.push(text); return i; } };
    assert.sameValue(+hook, i);
  }
  return saved;
}
for (let n = 0; n < 240; n++) {
  const saved = make(n);
  for (let k = 0; k < 4; k++) {
    const fresh = make(n + 512 + k);
    for (let i = 0; i < 6; i++) check(fresh[i], (n + 512 + k) * 8 + i);
  }
  assert.sameValue(saved.length, 6);
  for (let i = 0; i < 6; i++) check(saved[i], n * 8 + i);
}

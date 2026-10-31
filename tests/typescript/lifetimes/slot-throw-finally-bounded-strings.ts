/*---
description: Finally retains bounded strings on both normal and throwing loop paths.
features: [ts-lifetime-slot, ts-route-throw, ts-functions, ts-strings, ts-errors, ts-arrays]
---*/
// Fact: loop instances may share a frame slot only if disjoint (docs/foundations/memory.md, Where nts stands).
// Route: finally stores each string before later iterations reuse its site. Node preserves every retained iteration.
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
    try { if (i % 2 === 0) throw i; }
    catch (error) { assert.sameValue(error, i); }
    finally { saved.push(text); }
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

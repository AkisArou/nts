/*---
description: Shallow copies retain loop strings after their original owners are cleared.
features: [ts-lifetime-slot, ts-route-alias, ts-functions, ts-strings, ts-spread, ts-objects, ts-arrays]
---*/
// Fact: loop instances may share a frame slot only if disjoint (docs/foundations/memory.md, Where nts stands).
// Route: object spread preserves each text alias before the source field is cleared. Node preserves every retained iteration.
function check(text: string, id: number): void {
  assert.sameValue(text, String.fromCharCode(65 + id % 26, 97 + id % 26));
  assert.sameValue(text.length, 2);
}
function make(n: number): { text: string }[] {
  const saved: { text: string }[] = [];
  for (let i = 0; i < 6; i++) {
    const id = n * 8 + i;
    const owner = { text: String.fromCharCode(65 + id % 26) + String.fromCharCode(97 + id % 26) };
    assert.sameValue(owner.text.length, 2);
    const alias = { ...owner };
    owner.text = "";
    saved.push(alias);
  }
  return saved;
}
for (let n = 0; n < 240; n++) {
  const saved = make(n);
  for (let k = 0; k < 4; k++) {
    const fresh = make(n + 512 + k);
    for (let i = 0; i < 6; i++) check(fresh[i].text, (n + 512 + k) * 8 + i);
  }
  assert.sameValue(saved.length, 6);
  for (let i = 0; i < 6; i++) check(saved[i].text, n * 8 + i);
}

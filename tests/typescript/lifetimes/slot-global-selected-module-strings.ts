/*---
description: Module slots retain selected bounded strings after their loop continues.
features: [ts-lifetime-slot, ts-route-global, ts-functions, ts-strings, ts-modules]
flags: [module]
---*/
// Fact: loop instances may share a frame slot only if disjoint (docs/foundations/memory.md, Where nts stands).
// Route: two module variables preserve iterations one and three of one string site. Node preserves every retained iteration.
function check(text: string, id: number): void {
  assert.sameValue(text, String.fromCharCode(65 + id % 26, 97 + id % 26));
  assert.sameValue(text.length, 2);
}
let first = "";
let second = "";
function visit(n: number, keep: boolean): void {
  for (let i = 0; i < 6; i++) {
    const id = n * 8 + i;
    const text = String.fromCharCode(65 + id % 26) + String.fromCharCode(97 + id % 26);
    assert.sameValue(text.length, 2);
    if (keep && i === 1) first = text;
    if (keep && i === 3) second = text;
  }
}
for (let n = 0; n < 240; n++) {
  visit(n, true);
  for (let k = 0; k < 4; k++) visit(n + 512 + k, false);
  check(first, n * 8 + 1);
  check(second, n * 8 + 3);
  first = "";
  second = "";
}

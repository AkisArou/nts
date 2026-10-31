/*---
description: Object.assign preserves the payload array when its original region result dies.
features: [ts-lifetime-region, ts-route-alias, ts-functions, ts-objects, ts-strings, ts-arrays]
---*/
// Fact: result-contained allocations may share a region (docs/foundations/memory.md, The ladder of homes).
// Route: a shallow copy aliases the parts array before the original root is replaced. Node preserves the retained value after the result dies.
function build(n: number): { parts: string[]; size: number } {
  const text = String.fromCharCode(65 + n % 26) + ":" + n;
  return { parts: [text, text], size: text.length };
}
function churn(n: number): void {
  for (let i = 0; i < 8; i++) {
    const tree = build(n + 512 + i);
    assert.sameValue(tree.parts[0].length, tree.size);
    assert.sameValue(tree.parts[1], String.fromCharCode(65 + (n + 512 + i) % 26) + ":" + (n + 512 + i));
  }
}
function check(text: string, n: number): void {
  assert.sameValue(text, String.fromCharCode(65 + n % 26) + ":" + n);
  assert.sameValue(text.length, 2 + String(n).length);
}
function keep(n: number): string[] {
  let root = build(n);
  const alias = Object.assign({}, root);
  root = build(n + 256);
  assert.sameValue(root.size, root.parts[0].length);
  return alias.parts;
}
for (let n = 0; n < 240; n++) {
  const saved = keep(n);
  churn(n);
  assert.sameValue(saved.length, 2);
  check(saved[0], n);
  check(saved[1], n);
}

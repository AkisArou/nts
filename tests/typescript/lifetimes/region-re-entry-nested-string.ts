/*---
description: Re-entry keeps each detached region string separate from later invocations.
features: [ts-lifetime-region, ts-route-re-entry, ts-functions, ts-objects, ts-strings, ts-closures, ts-arrays]
---*/
// Fact: result-contained allocations may share a region (docs/foundations/memory.md, The ladder of homes).
// Route: a callback recursively enters the reader while its previous string is live. Node preserves the retained value after the result dies.
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
function observe(n: number, depth: number): void {
  const root = build(n);
  const text = root.parts[0];
  const enter = (): void => { if (depth > 0) observe(n + 17, depth - 1); };
  enter();
  churn(n);
  check(text, n);
}
for (let n = 0; n < 240; n++) observe(n, 3);

/*---
description: Implicit string conversion retains a string from its captured region result.
features: [ts-lifetime-region, ts-route-hook, ts-functions, ts-objects, ts-strings, ts-to-string, ts-template-literals, ts-closures, ts-arrays]
---*/
// Fact: result-contained allocations may share a region (docs/foundations/memory.md, The ladder of homes).
// Route: toString stores the result string during interpolation. Node preserves the retained value after the result dies.
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
function keep(n: number): string {
  const root = build(n);
  let saved = "";
  const hook = { toString(): string { saved = root.parts[0]; return "read"; } };
  assert.sameValue(`tag:${hook}`, "tag:read");
  return saved;
}
for (let n = 0; n < 240; n++) {
  const saved = keep(n);
  churn(n);
  check(saved, n);
}

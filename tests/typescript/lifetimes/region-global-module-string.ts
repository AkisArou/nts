/*---
description: A module slot retains a string after its region result goes out of scope.
features: [ts-lifetime-region, ts-route-global, ts-functions, ts-objects, ts-strings, ts-arrays, ts-modules]
flags: [module]
---*/
// Fact: result-contained allocations may share a region (docs/foundations/memory.md, The ladder of homes).
// Route: a module variable takes the string from the result array. Node preserves the retained value after the result dies.
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
let saved = "";
function publish(n: number): void {
  const root = build(n);
  saved = root.parts[0];
}
for (let n = 0; n < 240; n++) {
  publish(n);
  churn(n);
  check(saved, n);
  saved = "";
}

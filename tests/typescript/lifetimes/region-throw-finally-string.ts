/*---
description: A finally block keeps a result string while its builder scope unwinds.
features: [ts-lifetime-region, ts-route-throw, ts-functions, ts-objects, ts-strings, ts-errors, ts-arrays]
---*/
// Fact: result-contained allocations may share a region (docs/foundations/memory.md, The ladder of homes).
// Route: finally publishes the string before the raised number leaves the scope. Node preserves the retained value after the result dies.
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
function raise(n: number, saved: { value: string }): never {
  const root = build(n);
  try { throw n; }
  finally { saved.value = root.parts[0]; }
}
for (let n = 0; n < 240; n++) {
  const saved = { value: "" };
  let caught = false;
  try { raise(n, saved); } catch (error) {
    assert.sameValue(error, n);
    caught = true;
  }
  assert.sameValue(caught, true);
  churn(n);
  check(saved.value, n);
}

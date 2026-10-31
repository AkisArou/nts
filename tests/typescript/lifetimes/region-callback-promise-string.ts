/*---
description: A promise reaction hands on a string after its region result scope ends.
features: [ts-lifetime-region, ts-route-callback, ts-functions, ts-objects, ts-strings, ts-async, ts-arrays, ts-closures]
flags: [async]
---*/
// Fact: result-contained allocations may share a region (docs/foundations/memory.md, The ladder of homes).
// Route: Promise.then captures the result and returns its string for later reads. Node preserves the retained value after the result dies.
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
function keep(n: number): Promise<string> {
  const root = build(n);
  return Promise.resolve().then(() => root.parts[0]);
}
async function run(): Promise<void> {
  for (let n = 0; n < 240; n++) {
    const pending = keep(n);
    churn(n);
    const saved = await pending;
    churn(n + 16);
    check(saved, n);
  }
}
run().then(() => $DONE(), $DONE);

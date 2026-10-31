/*---
description: An async frame retains a result string beyond its root last use.
features: [ts-lifetime-region, ts-route-await, ts-functions, ts-objects, ts-strings, ts-async, ts-arrays]
flags: [async]
---*/
// Fact: result-contained allocations may share a region (docs/foundations/memory.md, The ladder of homes).
// Route: await keeps the string while another invocation builds replacement results. Node preserves the retained value after the result dies.
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
async function observe(n: number): Promise<void> {
  const root = build(n);
  const text = root.parts[0];
  await Promise.resolve();
  check(text, n);
}
async function run(): Promise<void> {
  for (let n = 0; n < 240; n++) {
    const pending = observe(n);
    churn(n);
    await pending;
  }
}
run().then(() => $DONE(), $DONE);

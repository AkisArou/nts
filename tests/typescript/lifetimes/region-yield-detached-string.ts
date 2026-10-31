/*---
description: A generated string remains readable after its owning result dies across yield.
features: [ts-lifetime-region, ts-route-yield, ts-functions, ts-objects, ts-strings, ts-generators, ts-iteration, ts-arrays]
---*/
// Fact: result-contained allocations may share a region (docs/foundations/memory.md, The ladder of homes).
// Route: the generator yields a length and retains only the string for resumption. Node preserves the retained value after the result dies.
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
function* observe(n: number): Generator<number, void, unknown> {
  const root = build(n);
  const text = root.parts[0];
  yield root.size;
  check(text, n);
}
for (let n = 0; n < 240; n++) {
  const iterator = observe(n);
  const first = iterator.next();
  assert.sameValue(first.done, false);
  assert.sameValue(first.value, 2 + String(n).length);
  churn(n);
  assert.sameValue(iterator.next().done, true);
}

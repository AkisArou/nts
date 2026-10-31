/*---
description: A reader returned by a callee owns the string it formerly borrowed.
features: [ts-lifetime-borrow, ts-route-closure, ts-functions, ts-iteration, ts-arrays, ts-strings, ts-closures, ts-objects]
---*/
// Fact: reads borrow while their owner is alive (docs/foundations/memory.md, "Where nts stands").
// Route: a stored closure outlives the borrowed argument; Node keeps the original text and length.
function word(n: number): string { return String.fromCharCode(97 + n % 26) + ":" + n; }
function churn(seed: number): void {
  const words: string[] = [];
  for (let i = 0; i < 24; i++) words.push(word(seed + 1000 + i));
  let length = 0;
  for (const text of words) length += text.length;
  assert.sameValue(length, 144);
}
function check(text: string, n: number): void {
  assert.sameValue(text, String.fromCharCode(97 + n % 26) + ":" + n);
  assert.sameValue(text.length, (String.fromCharCode(97 + n % 26) + ":" + n).length);
}
function retain(text: string): () => string {
  const length = text.length;
  assert.sameValue(length > 0, true);
  return () => text;
}
for (let n = 0; n < 256; n++) {
  const owner = { text: word(n) };
  const read = retain(owner.text);
  owner.text = "";
  churn(n);
  check(read(), n);
}

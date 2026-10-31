/*---
description: A callback supplied to a read-only call can retain its borrowed parameter.
features: [ts-lifetime-borrow, ts-route-callback, ts-functions, ts-iteration, ts-strings, ts-closures, ts-objects, ts-arrays, ts-function-types]
---*/
// Fact: reads borrow while their owner is alive (docs/foundations/memory.md, "Where nts stands").
// Route: the higher-order callee invokes a saving callback; Node keeps the string after its owner clears.
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
function visit(text: string, save: (value: string) => void): number {
  const length = text.length;
  save(text);
  return length;
}
for (let n = 0; n < 256; n++) {
  const owner = { text: word(n) };
  const saved: string[] = [];
  assert.sameValue(visit(owner.text, text => saved.push(text)), word(n).length);
  owner.text = "";
  churn(n);
  check(saved[0], n);
}

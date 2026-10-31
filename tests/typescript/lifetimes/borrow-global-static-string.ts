/*---
description: A static field owns a string borrowed from an array element.
features: [ts-lifetime-borrow, ts-route-global, ts-functions, ts-iteration, ts-strings, ts-class, ts-static, ts-class-fields, ts-arrays]
---*/
// Fact: reads borrow while their owner is alive (docs/foundations/memory.md, "Where nts stands").
// Route: a static store survives truncation of the lending array; Node keeps exact text and length.
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
class Saved {
  static text = "";
  static accept(text: string): void { Saved.text = text; }
}
for (let n = 0; n < 256; n++) {
  const owner = [word(n)];
  Saved.accept(owner[0]);
  owner.length = 0;
  churn(n);
  check(Saved.text, n);
}

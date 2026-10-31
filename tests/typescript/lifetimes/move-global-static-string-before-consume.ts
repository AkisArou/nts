/*---
description: A static string survives the last-use handoff of its original local.
features: [ts-lifetime-move, ts-route-global, ts-functions, ts-iteration, ts-arrays, ts-strings, ts-class, ts-static, ts-class-fields]
---*/
// Fact: a last-use handoff moves its count (docs/foundations/memory.md, "Where nts stands").
// Route: a static field keeps the string before consumption; Node reads its unchanged text and length.
function word(n: number): string { return String.fromCharCode(97 + n % 26) + ":" + n; }
function consume(text: string): number {
  const destination: string[] = [];
  destination.push(text);
  const length = destination[0].length;
  destination.length = 0;
  return length;
}
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
class Saved { static text = ""; }
function prepare(n: number): void {
  const text = word(n);
  Saved.text = text;
  const expected = text.length;
  assert.sameValue(consume(text), expected);
}
for (let n = 0; n < 256; n++) {
  prepare(n);
  churn(n);
  check(Saved.text, n);
}

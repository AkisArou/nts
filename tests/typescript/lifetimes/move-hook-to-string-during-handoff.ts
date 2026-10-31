/*---
description: An implicit conversion may keep a string passed for its final direct use.
features: [ts-lifetime-move, ts-route-hook, ts-functions, ts-iteration, ts-arrays, ts-strings, ts-to-string, ts-to-primitive, ts-objects, ts-closures]
---*/
// Fact: a last-use handoff moves its count (docs/foundations/memory.md, "Where nts stands").
// Route: toString saves the string while evaluating the consuming call; Node keeps exact text and length.
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
function accept(text: string, tag: string): void {
  const expected = text.length;
  assert.sameValue(consume(text), expected);
  assert.sameValue(tag, "go");
}
function prepare(n: number): string[] {
  const text = word(n);
  const saved: string[] = [];
  const hook = { toString(): string { saved.push(text); return "go"; } };
  accept(text, String(hook));
  return saved;
}
for (let n = 0; n < 256; n++) {
  const saved = prepare(n);
  churn(n);
  check(saved[0], n);
}

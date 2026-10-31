/*---
description: A string captured by a stored reader survives consumption of its original local.
features: [ts-lifetime-move, ts-route-closure, ts-functions, ts-iteration, ts-arrays, ts-strings, ts-closures]
---*/
// Fact: a last-use handoff moves its count (docs/foundations/memory.md, "Where nts stands").
// Route: a returned closure keeps the string after its last direct handoff; Node retains exact text and length.
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
function prepare(n: number): () => string {
  const text = word(n);
  const read = (): string => text;
  const expected = text.length;
  assert.sameValue(consume(text), expected);
  return read;
}
for (let n = 0; n < 256; n++) {
  const read = prepare(n);
  churn(n);
  check(read(), n);
}

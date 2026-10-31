/*---
description: A generator parameter borrowed from an array stays alive after yield and truncation.
features: [ts-lifetime-borrow, ts-route-yield, ts-functions, ts-iteration, ts-strings, ts-generators, ts-arrays]
---*/
// Fact: reads borrow while their owner is alive (docs/foundations/memory.md, "Where nts stands").
// Route: the suspended generator keeps the string parameter; Node resumes with exact text and length.
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
function* read(text: string, n: number): Generator<number, void, unknown> {
  const length = text.length;
  yield length;
  check(text, n);
}
for (let n = 0; n < 256; n++) {
  const owner = [word(n)];
  const iterator = read(owner[0], n);
  assert.sameValue(iterator.next().value, word(n).length);
  owner.length = 0;
  churn(n);
  assert.sameValue(iterator.next().done, true);
}

/*---
description: An awaited promise owns its string after the original local is consumed.
features: [ts-lifetime-move, ts-route-await, ts-functions, ts-iteration, ts-arrays, ts-strings, ts-async]
flags: [async]
---*/
// Fact: a last-use handoff moves its count (docs/foundations/memory.md, "Where nts stands").
// Route: the promise keeps a string for the awaiting continuation; Node resumes with exact text and length.
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
async function read(n: number): Promise<void> {
  const text = word(n);
  const pending = Promise.resolve(text);
  const expected = text.length;
  assert.sameValue(consume(text), expected);
  const kept = await pending;
  churn(n);
  check(kept, n);
}
async function main(): Promise<void> {
  for (let n = 0; n < 256; n++) await read(n);
}
main().then(() => $DONE(), $DONE);

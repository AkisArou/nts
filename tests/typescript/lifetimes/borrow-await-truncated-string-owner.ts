/*---
description: An array element string borrow survives await and truncation of its lending array.
features: [ts-lifetime-borrow, ts-route-await, ts-functions, ts-iteration, ts-strings, ts-async, ts-arrays]
flags: [async]
---*/
// Fact: reads borrow while their owner is alive (docs/foundations/memory.md, "Where nts stands").
// Route: the async local retains a string while its source is cleared; Node resumes with the original text.
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
async function read(owner: string[], n: number): Promise<void> {
  const text = owner[0];
  await Promise.resolve();
  churn(n);
  check(text, n);
}
async function main(): Promise<void> {
  for (let n = 0; n < 256; n++) {
    const owner = [word(n)];
    const pending = read(owner, n);
    owner.length = 0;
    await pending;
  }
}
main().then(() => $DONE(), $DONE);

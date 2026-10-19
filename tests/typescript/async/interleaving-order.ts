/*---
description: Two async functions interleave at each await, after the synchronous code that started them.
features: [ts-async]
flags: [async]
---*/
const log: string[] = [];
async function task(label: string): Promise<void> {
  log.push(`${label}1`);
  await undefined;
  log.push(`${label}2`);
  await undefined;
  log.push(`${label}3`);
}
async function main(): Promise<void> {
  const both = Promise.all([task("a"), task("b")]);
  log.push("sync");
  await both;
  assert.sameValue(log.join(","), "a1,b1,sync,a2,b2,a3,b3");
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));

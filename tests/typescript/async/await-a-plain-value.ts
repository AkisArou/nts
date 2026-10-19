/*---
description: Awaiting a value that is not a promise gives the value back, after a turn of the job queue.
features: [ts-async]
flags: [async]
---*/
const log: string[] = [];
async function main(): Promise<void> {
  Promise.resolve().then(() => log.push("job"));
  const value: number = await 5;
  log.push("resumed");
  assert.sameValue(value, 5);
  assert.sameValue(log.join(","), "job,resumed");
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));

/*---
description: A finally block runs after an awaited failure and before the caller's catch.
features: [ts-async, ts-errors]
flags: [async]
---*/
const log: string[] = [];
async function work(): Promise<void> {
  try {
    log.push("try");
    await Promise.reject(new TypeError("bad"));
    log.push("unreached");
  } finally {
    log.push("finally");
  }
}
async function main(): Promise<void> {
  try {
    await work();
  } catch (error) {
    log.push(error instanceof TypeError ? "caught" : "other");
  }
  assert.sameValue(log.join(","), "try,finally,caught");
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));

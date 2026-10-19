/*---
description: An awaited rejection is caught as unknown and narrowed by instanceof before its message is read.
features: [ts-async, ts-errors, ts-unknown, ts-narrowing]
flags: [async]
---*/
async function failing(): Promise<number> {
  throw new RangeError("too far");
}
async function main(): Promise<void> {
  let message = "none";
  try {
    await failing();
  } catch (error) {
    message = error instanceof RangeError ? `range: ${error.message}` : "other";
  }
  assert.sameValue(message, "range: too far");
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));

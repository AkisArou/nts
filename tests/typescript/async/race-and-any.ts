/*---
description: Promise.race settles with the first promise to settle; Promise.any with the first to fulfil.
features: [ts-async]
flags: [async]
---*/
async function main(): Promise<void> {
  const never = new Promise<string>(() => {});
  const first = await Promise.race([never, Promise.resolve("fast")]);
  assert.sameValue(first, "fast");
  const fulfilled = await Promise.any([Promise.reject(new Error("no")), Promise.resolve(2)]);
  assert.sameValue(fulfilled, 2);
  let reasons = 0;
  try {
    await Promise.any([Promise.reject(new Error("a")), Promise.reject(new Error("b"))]);
  } catch (error) {
    if (error instanceof AggregateError) reasons = error.errors.length;
  }
  assert.sameValue(reasons, 2);
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));

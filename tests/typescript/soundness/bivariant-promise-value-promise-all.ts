/*---
description: A string fulfilled through a bivariant resolver survives Promise.all under a number type.
features: [ts-unsound-bivariance, ts-async, ts-functions, ts-typeof-operator, ts-conversions, ts-arrays, ts-interfaces, ts-objects, ts-arrow-functions]
flags: [async]
---*/
// TypeScript's method bivariance accepts resolve at the unknown-typed sink.
// It fulfills a numeric promise with a string; node delivers that actual string.
interface Sink { put(value: unknown): void; }
function make(): Promise<number> {
  return new Promise<number>((resolve) => {
    const sink: Sink = { put: resolve };
    sink.put("7");
  });
}
async function check(): Promise<void> {
  const values: number[] = await Promise.all([make(), Promise.resolve(2)]);
  assert.sameValue(typeof values[0], "string");
  assert.sameValue(String(values[0] + 1), "71");
  assert.sameValue(values[1], 2);
}
check().then(() => $DONE(), (error: unknown) => $DONE(error));

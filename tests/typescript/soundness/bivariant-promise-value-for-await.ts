/*---
description: A string fulfilled through a bivariant resolver survives for-await iteration under a number type.
features: [ts-unsound-bivariance, ts-async, ts-functions, ts-typeof-operator, ts-conversions, ts-arrays, ts-async-generators, ts-iteration, ts-interfaces, ts-objects, ts-arrow-functions, ts-template-literals]
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
  const seen: string[] = [];
  for await (const value of [make()]) seen.push(`${typeof value}:${value + 1}`);
  assert.compareArray(seen, ["string:71"]);
}
check().then(() => $DONE(), (error: unknown) => $DONE(error));

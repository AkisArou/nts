/*---
description: A string fulfilled through a bivariant resolver survives a then callback under a number type.
features: [ts-unsound-bivariance, ts-async, ts-functions, ts-typeof-operator, ts-conversions, ts-arrow-functions, ts-interfaces, ts-objects]
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
  let visits = 0;
  await make().then((value: number) => {
    visits++;
    assert.sameValue(typeof value, "string");
    assert.sameValue(String(value + 1), "71");
  });
  assert.sameValue(visits, 1);
}
check().then(() => $DONE(), (error: unknown) => $DONE(error));

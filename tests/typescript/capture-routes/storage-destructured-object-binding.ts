/*---
description: A reader retains the binding introduced and later assigned by typed object destructuring.
features: [ts-capture-route-storage, ts-closures, ts-functions, ts-function-types, ts-destructuring, ts-unions, ts-bigint, ts-objects, ts-arrays]
---*/
// Route: destructured union binding captured before another destructuring assignment; node reads the rebound value and later clear.
type CaptureValue = number | string | boolean | undefined | bigint | { mark: number } | number[];
const captureObject = { mark: 7 }; const captureArray: number[] = [1];
const inputs: CaptureValue[] = [0, -0, NaN, 1.5, 2147483648, "", "latin", "\u00e9\u4e2d", false, true, undefined, 9007199254740993n, captureObject, captureArray];
function checkCapture(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true);
  assert.sameValue(typeof actual, typeof expected);
}
for (const input of inputs) {
  const log: string[] = ["initial"]; let { payload: value }: { payload: CaptureValue } = { payload: 1 };
  const read: () => CaptureValue = () => { log.push("read"); return value; };
  const before = read(); checkCapture(before, 1);
  ({ payload: value } = { payload: input }); log.push("destructure");
  const after = read(); checkCapture(after, input);
  value = undefined; log.push("clear");
  const cleared = read(); checkCapture(cleared, undefined);
  log.push("state"); checkCapture(value, undefined);
  assert.compareArray(log, ["initial", "read", "destructure", "read", "clear", "read", "state"]);
}

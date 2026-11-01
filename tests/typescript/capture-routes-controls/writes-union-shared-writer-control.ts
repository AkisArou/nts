/*---
description: Control for writes-union-shared-writer; direct reads keep the same input values, operations and observations.
features: [ts-capture-route-writes, ts-closures, ts-functions, ts-function-types, ts-unions, ts-numbers, ts-strings, ts-bigint, ts-objects, ts-arrays]
---*/
// Control: Every captured read becomes a direct read at the same point.
type CaptureValue = number | string | boolean | undefined | bigint | { mark: number } | number[];
const captureObject = { mark: 7 }; const captureArray: number[] = [1];
const inputs: CaptureValue[] = [0, -0, NaN, 1.5, 2147483648, "", "latin", "\u00e9\u4e2d", false, true, undefined, 9007199254740993n, captureObject, captureArray];
function checkCapture(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true);
  assert.sameValue(typeof actual, typeof expected);
}
for (const input of inputs) {
  const log: string[] = ["initial"]; let value: CaptureValue = 1;
  log.push("read"); const before = value; checkCapture(before, 1);
  value = input; log.push("writer"); log.push("read"); const after = value; checkCapture(after, input);
  value = undefined; log.push("outside");
  log.push("read"); const cleared = value; checkCapture(cleared, undefined);
  value = input; log.push("writer"); log.push("read"); const restored = value; checkCapture(restored, input);
  log.push("state"); checkCapture(value, input);
  assert.compareArray(log, ["initial", "read", "writer", "read", "outside", "read", "writer", "read", "state"]);
}

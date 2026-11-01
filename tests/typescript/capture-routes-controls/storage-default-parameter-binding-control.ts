/*---
description: Control for storage-default-parameter-binding; direct reads keep the same input values, operations and observations.
features: [ts-capture-route-storage, ts-closures, ts-functions, ts-function-types, ts-default-parameters, ts-unions, ts-bigint, ts-objects, ts-arrays]
---*/
// Control: Every captured read becomes a direct read at the same point.
type CaptureValue = number | string | boolean | undefined | bigint | { mark: number } | number[];
const captureObject = { mark: 7 }; const captureArray: number[] = [1];
const inputs: CaptureValue[] = [0, -0, NaN, 1.5, 2147483648, "", "latin", "\u00e9\u4e2d", false, true, undefined, 9007199254740993n, captureObject, captureArray];
function checkCapture(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true);
  assert.sameValue(typeof actual, typeof expected);
}
function inspectDefaultValue(input: CaptureValue, expected: CaptureValue, log: string[], value: CaptureValue = (log.push("default"), 1)): void {
  log.push("parameter");
  log.push("read"); const before = value; checkCapture(before, expected);
  value = input; log.push("write");
  log.push("read"); const after = value; checkCapture(after, input);
  value = undefined; log.push("clear");
  log.push("read"); const cleared = value; checkCapture(cleared, undefined);
  log.push("state"); checkCapture(value, undefined);
}
for (const input of inputs) for (const supplied of [false, true]) {
  const log: string[] = [];
  if (supplied) inspectDefaultValue(input, 0, log, 0); else inspectDefaultValue(input, 1, log);
  const expected = supplied ? ["parameter", "read", "write", "read", "clear", "read", "state"] : ["default", "parameter", "read", "write", "read", "clear", "read", "state"];
  assert.compareArray(log, expected);
}

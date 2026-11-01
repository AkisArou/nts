/*---
description: A closure retains a defaulted parameter binding after writes in the function body.
features: [ts-capture-route-storage, ts-closures, ts-functions, ts-function-types, ts-default-parameters, ts-unions, ts-bigint, ts-objects, ts-arrays]
---*/
// Route: parameter initialized explicitly or by an effectful default, then captured and reassigned; node preserves the shared parameter binding.
type CaptureValue = number | string | boolean | undefined | bigint | { mark: number } | number[];
const captureObject = { mark: 7 }; const captureArray: number[] = [1];
const inputs: CaptureValue[] = [0, -0, NaN, 1.5, 2147483648, "", "latin", "\u00e9\u4e2d", false, true, undefined, 9007199254740993n, captureObject, captureArray];
function checkCapture(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true);
  assert.sameValue(typeof actual, typeof expected);
}
function inspectDefaultValue(input: CaptureValue, expected: CaptureValue, log: string[], value: CaptureValue = (log.push("default"), 1)): void {
  log.push("parameter");
  const read: () => CaptureValue = () => { log.push("read"); return value; };
  const before = read(); checkCapture(before, expected);
  value = input; log.push("write");
  const after = read(); checkCapture(after, input);
  value = undefined; log.push("clear");
  const cleared = read(); checkCapture(cleared, undefined);
  log.push("state"); checkCapture(value, undefined);
}
for (const input of inputs) for (const supplied of [false, true]) {
  const log: string[] = [];
  if (supplied) inspectDefaultValue(input, 0, log, 0); else inspectDefaultValue(input, 1, log);
  const expected = supplied ? ["parameter", "read", "write", "read", "clear", "read", "state"] : ["default", "parameter", "read", "write", "read", "clear", "read", "state"];
  assert.compareArray(log, expected);
}

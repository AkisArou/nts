/*---
description: A default reader parameter shares the earlier parameter binding with the function body.
features: [ts-capture-route-storage, ts-closures, ts-functions, ts-function-types, ts-default-parameters, ts-unions, ts-bigint, ts-objects, ts-arrays]
---*/
// Route: default closure captures an earlier typed parameter before the body writes it; node reads the same binding across the parameter and body scopes.
type CaptureValue = number | string | boolean | undefined | bigint | { mark: number } | number[];
const captureObject = { mark: 7 }; const captureArray: number[] = [1];
const inputs: CaptureValue[] = [0, -0, NaN, 1.5, 2147483648, "", "latin", "\u00e9\u4e2d", false, true, undefined, 9007199254740993n, captureObject, captureArray];
function checkCapture(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true);
  assert.sameValue(typeof actual, typeof expected);
}
for (const input of inputs) {
  const log: string[] = ["initial"];
  function inspectDefaultReader(value: CaptureValue = 1, read: () => CaptureValue = () => { log.push("read"); return value; }): void {
    const before = read(); checkCapture(before, 1);
    value = input; log.push("write");
    const after = read(); checkCapture(after, input);
    value = undefined; log.push("clear");
    const cleared = read(); checkCapture(cleared, undefined);
    log.push("state"); checkCapture(value, undefined);
  }
  inspectDefaultReader();
  assert.compareArray(log, ["initial", "read", "write", "read", "clear", "read", "state"]);
}

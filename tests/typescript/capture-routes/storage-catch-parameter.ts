/*---
description: A closure observes writes to an unknown catch parameter for primitive and identity-valued throws.
features: [ts-capture-route-storage, ts-closures, ts-functions, ts-function-types, ts-unknown, ts-errors, ts-unions, ts-bigint, ts-objects, ts-arrays]
---*/
// Route: unknown catch binding captured before clear and restore; node returns the exact current caught value.
type CaptureValue = number | string | boolean | undefined | bigint | { mark: number } | number[];
const captureObject = { mark: 7 }; const captureArray: number[] = [1];
const inputs: CaptureValue[] = [0, -0, NaN, 1.5, 2147483648, "", "latin", "\u00e9\u4e2d", false, true, undefined, 9007199254740993n, captureObject, captureArray];
function checkCapture(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true);
  assert.sameValue(typeof actual, typeof expected);
}
for (const input of inputs) {
  const log: string[] = [];
  try { log.push("throw"); throw input; } catch (caught: unknown) {
    log.push("catch");
    const read: () => unknown = () => { log.push("read"); return caught; };
    const before = read(); checkCapture(before, input);
    caught = undefined; log.push("clear");
    const cleared = read(); checkCapture(cleared, undefined);
    caught = input; log.push("restore");
    const restored = read(); checkCapture(restored, input);
    log.push("state"); checkCapture(caught, input);
  }
  assert.compareArray(log, ["throw", "catch", "read", "clear", "read", "restore", "read", "state"]);
}

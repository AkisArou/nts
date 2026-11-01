/*---
description: A sibling writer changes every representation of one union capture and restores it after an outside clear.
features: [ts-capture-route-writes, ts-closures, ts-functions, ts-function-types, ts-unions, ts-numbers, ts-strings, ts-bigint, ts-objects, ts-arrays]
---*/
// Route: two function-typed closures share a union binding with an outside writer; node keeps each value and object identity.
type CaptureValue = number | string | boolean | undefined | bigint | { mark: number } | number[];
const captureObject = { mark: 7 }; const captureArray: number[] = [1];
const inputs: CaptureValue[] = [0, -0, NaN, 1.5, 2147483648, "", "latin", "\u00e9\u4e2d", false, true, undefined, 9007199254740993n, captureObject, captureArray];
function checkCapture(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true);
  assert.sameValue(typeof actual, typeof expected);
}
for (const input of inputs) {
  const log: string[] = ["initial"]; let value: CaptureValue = 1;
  const read: () => CaptureValue = () => { log.push("read"); return value; };
  const write: (next: CaptureValue) => void = next => { value = next; log.push("writer"); };
  const before = read(); checkCapture(before, 1);
  write(input); const after = read(); checkCapture(after, input);
  value = undefined; log.push("outside");
  const cleared = read(); checkCapture(cleared, undefined);
  write(input); const restored = read(); checkCapture(restored, input);
  log.push("state"); checkCapture(value, input);
  assert.compareArray(log, ["initial", "read", "writer", "read", "outside", "read", "writer", "read", "state"]);
}

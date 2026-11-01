/*---
description: Three nested function types preserve one live binding after both factories return.
features: [ts-capture-route-storage, ts-closures, ts-functions, ts-function-types, ts-unions, ts-bigint, ts-objects, ts-arrays]
---*/
// Route: three nested closures carry a union binding into the innermost reader; node sees both subsequent assignments.
type CaptureValue = number | string | boolean | undefined | bigint | { mark: number } | number[];
const captureObject = { mark: 7 }; const captureArray: number[] = [1];
const inputs: CaptureValue[] = [0, -0, NaN, 1.5, 2147483648, "", "latin", "\u00e9\u4e2d", false, true, undefined, 9007199254740993n, captureObject, captureArray];
function checkCapture(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true);
  assert.sameValue(typeof actual, typeof expected);
}
for (const input of inputs) {
  const log: string[] = ["initial"]; let value: CaptureValue = 1;
  const outer: () => () => () => CaptureValue = () => { log.push("outer"); return () => { log.push("middle"); return () => { log.push("read"); return value; }; }; };
  const middle = outer(); const read = middle();
  const before = read(); checkCapture(before, 1);
  value = input; log.push("write");
  const after = read(); checkCapture(after, input);
  value = undefined; log.push("clear");
  const cleared = read(); checkCapture(cleared, undefined);
  log.push("state"); checkCapture(value, undefined);
  assert.compareArray(log, ["initial", "outer", "middle", "read", "write", "read", "clear", "read", "state"]);
}

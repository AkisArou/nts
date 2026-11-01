/*---
description: A typed interface holds a reader that observes later union binding writes and clearing.
features: [ts-capture-route-storage, ts-closures, ts-functions, ts-function-types, ts-unions, ts-bigint, ts-numbers, ts-strings, ts-objects, ts-arrays, ts-interfaces, ts-class, ts-class-fields]
---*/
// Route: union binding captured by a reader stored in a typed interface; node reads each later representation at the call site.
type CaptureValue = number | string | boolean | undefined | bigint | { mark: number } | number[];
const captureObject = { mark: 7 }; const captureArray: number[] = [1];
const inputs: CaptureValue[] = [0, -0, NaN, 1.5, 2147483648, "", "latin", "\u00e9\u4e2d", false, true, undefined, 9007199254740993n, captureObject, captureArray];
interface CaptureReaderView { read: () => CaptureValue; }
class LeadingCaptureReader implements CaptureReaderView { read: () => CaptureValue; marker: number = 1; constructor(read: () => CaptureValue) { this.read = read; } }
class TrailingCaptureReader implements CaptureReaderView { marker: number = 2; read: () => CaptureValue; constructor(read: () => CaptureValue) { this.read = read; } }
function checkCapture(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true);
  assert.sameValue(typeof actual, typeof expected);
}
for (const input of inputs) for (const alternate of [false, true]) {
  const log: string[] = ["initial"]; let value: CaptureValue = 1;
  const reader: () => CaptureValue = () => { log.push("read"); return value; };
  const stored: CaptureReaderView = alternate ? new TrailingCaptureReader(reader) : new LeadingCaptureReader(reader);
  const before = stored.read(); checkCapture(before, 1);
  value = input; log.push("write");
  const after = stored.read(); checkCapture(after, input);
  value = undefined; log.push("clear");
  const cleared = stored.read(); checkCapture(cleared, undefined);
  log.push("state"); checkCapture(value, undefined);
  assert.compareArray(log, ["initial", "read", "write", "read", "clear", "read", "state"]);
}

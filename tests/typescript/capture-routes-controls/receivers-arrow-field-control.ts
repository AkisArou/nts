/*---
description: Control for receivers-arrow-field; direct original-receiver reads keep every input, effect and observation.
features: [ts-capture-route-receivers, ts-closures, ts-arrow-functions, ts-function-types, ts-this, ts-class, ts-class-fields, ts-unions]
---*/
// Control: remove the captured arrows; read the original receiver at the same points.
interface CaptureObject { tag: string; }
type CaptureValue = number | string | boolean | undefined | bigint | CaptureObject | number[];
const identity: CaptureObject = { tag: "identity" }; const arrayValue: number[] = [1];
const rows: { value: CaptureValue; kind: string }[] = [
  { value: 0, kind: "number" },
  { value: -0, kind: "number" },
  { value: NaN, kind: "number" },
  { value: 0.5, kind: "number" },
  { value: 2147483648, kind: "number" },
  { value: "", kind: "string" },
  { value: "\u00e9\u4e2d", kind: "string" },
  { value: false, kind: "boolean" },
  { value: true, kind: "boolean" },
  { value: undefined, kind: "undefined" },
  { value: 9007199254740993n, kind: "bigint" },
  { value: identity, kind: "object" },
  { value: arrayValue, kind: "object" },
];
function checkCapture(actual: CaptureValue, expected: CaptureValue, kind: string): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, kind);
}
class CaptureReceiver {
  value: CaptureValue; log: string[] = [];
  constructor() { this.value = 1; this.log.push("init"); }
}
for (const row of rows) {
  const receiver = new CaptureReceiver();
  receiver.log.push("read"); const before: CaptureValue = receiver.value;
  checkCapture(before, 1, "number");
  receiver.value = row.value; receiver.log.push("write");
  receiver.log.push("read"); const after: CaptureValue = receiver.value;
  checkCapture(after, row.value, row.kind);
  if (Array.isArray(after)) { after.push(9); receiver.log.push("mutate"); }
  receiver.log.push("read"); const final: CaptureValue = receiver.value;
  checkCapture(final, row.value, row.kind);
  if (Array.isArray(final)) assert.compareArray(final, [1, 9]);
  receiver.log.push("state"); checkCapture(receiver.value, row.value, row.kind);
  assert.compareArray(receiver.log, Array.isArray(row.value) ? ["init", "read", "write", "read", "mutate", "read", "state"] : ["init", "read", "write", "read", "read", "state"]);
}

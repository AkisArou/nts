/*---
description: An arrow callback ignores map thisArg and reads each later value of its original receiver.
features: [ts-capture-route-receivers, ts-closures, ts-arrow-functions, ts-function-types, ts-this, ts-class, ts-class-fields, ts-unions, ts-arrays, ts-functions]
---*/
// Route: an arrow passed to map ignores its foreign thisArg across original-field writes; node reads the current original receiver field.
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
  make(): (index: number) => CaptureValue { return (index: number) => { this.log.push("read:" + index); return this.value; }; }
}
for (const row of rows) {
  const receiver = new CaptureReceiver(); const read: (index: number) => CaptureValue = receiver.make();
  const other = new CaptureReceiver(); other.value = "foreign"; other.log.push("foreign");
  const beforeValues: CaptureValue[] = [0].map(read, other);
  assert.sameValue(beforeValues.length, 1); const before: CaptureValue = beforeValues[0];
  checkCapture(before, 1, "number");
  receiver.value = row.value; receiver.log.push("write");
  const afterValues: CaptureValue[] = [0].map(read, other);
  assert.sameValue(afterValues.length, 1); const after: CaptureValue = afterValues[0];
  checkCapture(after, row.value, row.kind);
  if (Array.isArray(after)) { after.push(9); receiver.log.push("mutate"); }
  const finalValues: CaptureValue[] = [0].map(read, other);
  assert.sameValue(finalValues.length, 1); const final: CaptureValue = finalValues[0];
  checkCapture(final, row.value, row.kind);
  if (Array.isArray(final)) assert.compareArray(final, [1, 9]);
  receiver.log.push("state"); checkCapture(receiver.value, row.value, row.kind);
  assert.compareArray(receiver.log, Array.isArray(row.value) ? ["init", "read:0", "write", "read:0", "mutate", "read:0", "state"] : ["init", "read:0", "write", "read:0", "read:0", "state"]);
  other.log.push("state"); checkCapture(other.value, "foreign", "string"); assert.compareArray(other.log, ["init", "foreign", "state"]);
}

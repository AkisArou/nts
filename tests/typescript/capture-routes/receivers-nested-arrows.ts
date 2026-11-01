/*---
description: Nested arrows share the lexical receiver through later field writes and array mutation.
features: [ts-capture-route-receivers, ts-closures, ts-arrow-functions, ts-function-types, ts-this, ts-class, ts-class-fields, ts-unions]
---*/
// Route: two nested arrows retain a method this across later receiver-field writes; node reads the current original receiver field.
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
  make(): () => () => CaptureValue { return () => { this.log.push("outer"); return () => { this.log.push("read"); return this.value; }; }; }
}
for (const row of rows) {
  const receiver = new CaptureReceiver(); const outer: () => () => CaptureValue = receiver.make();
  const read: () => CaptureValue = outer();
  const before: CaptureValue = read();
  checkCapture(before, 1, "number");
  receiver.value = row.value; receiver.log.push("write");
  const after: CaptureValue = read();
  checkCapture(after, row.value, row.kind);
  if (Array.isArray(after)) { after.push(9); receiver.log.push("mutate"); }
  const final: CaptureValue = read();
  checkCapture(final, row.value, row.kind);
  if (Array.isArray(final)) assert.compareArray(final, [1, 9]);
  receiver.log.push("state"); checkCapture(receiver.value, row.value, row.kind);
  assert.compareArray(receiver.log, Array.isArray(row.value) ? ["init", "outer", "read", "write", "read", "mutate", "read", "state"] : ["init", "outer", "read", "write", "read", "read", "state"]);
}

/*---
description: Control for receivers-static-block-arrow; direct original-receiver reads keep every input, effect and observation.
features: [ts-capture-route-receivers, ts-closures, ts-arrow-functions, ts-function-types, ts-this, ts-class, ts-class-fields, ts-unions, ts-static, ts-class-static-block]
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
class CaptureStatic {
  static value: CaptureValue; static log: string[] = [];
}
for (const row of rows) {
  CaptureStatic.log.length = 0; CaptureStatic.value = 1; CaptureStatic.log.push("init");
  CaptureStatic.log.push("read"); const before: CaptureValue = CaptureStatic.value;
  checkCapture(before, 1, "number");
  CaptureStatic.value = row.value; CaptureStatic.log.push("write");
  CaptureStatic.log.push("read"); const after: CaptureValue = CaptureStatic.value;
  checkCapture(after, row.value, row.kind);
  if (Array.isArray(after)) { after.push(9); CaptureStatic.log.push("mutate"); }
  CaptureStatic.log.push("read"); const final: CaptureValue = CaptureStatic.value;
  checkCapture(final, row.value, row.kind);
  if (Array.isArray(final)) assert.compareArray(final, [1, 9]);
  CaptureStatic.log.push("state"); checkCapture(CaptureStatic.value, row.value, row.kind);
  assert.compareArray(CaptureStatic.log, Array.isArray(row.value) ? ["init", "read", "write", "read", "mutate", "read", "state"] : ["init", "read", "write", "read", "read", "state"]);
}

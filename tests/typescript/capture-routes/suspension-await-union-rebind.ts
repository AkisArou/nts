/*---
description: A union reader survives a wide string write before await and a different representation after it.
features: [ts-capture-route-suspension, ts-closures, ts-function-types, ts-functions, ts-async, ts-unions, ts-arrays, ts-bigint, ts-objects]
flags: [async]
---*/
// Route: a typed union binding read before and after await; node observes every write in order.
interface SuspendedPayload { marker: string; }
type SuspensionValue = number | string | boolean | undefined | bigint | SuspendedPayload | number[];
const objectValue: SuspendedPayload = { marker: "identity" }; const arrayValue: number[] = [1, 2];
const samples: { input: SuspensionValue; kind: string }[] = [
  { input: 1, kind: "number" }, { input: -0, kind: "number" }, { input: NaN, kind: "number" },
  { input: 0.5, kind: "number" }, { input: 2147483648, kind: "number" },
  { input: "", kind: "string" }, { input: "\u00e9", kind: "string" }, { input: "\u4e2d\ud83d\ude00", kind: "string" },
  { input: false, kind: "boolean" }, { input: true, kind: "boolean" },
  { input: undefined, kind: "undefined" }, { input: 9007199254740993n, kind: "bigint" },
  { input: objectValue, kind: "object" }, { input: arrayValue, kind: "object" }
];
function captureCheck(actual: unknown, expected: unknown, kind: string): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, kind);
}
async function main(): Promise<void> {
  for (const row of samples) {
    let value: SuspensionValue = 1; const log: string[] = ["write:initial"];
    const read: () => SuspensionValue = () => { log.push("read"); return value; };
    captureCheck(read(), 1, "number");
    value = "\u0101"; log.push("write:before"); captureCheck(read(), "\u0101", "string");
    log.push("await"); await Promise.resolve(); log.push("resume");
    value = row.input; log.push("write:after"); captureCheck(read(), row.input, row.kind);
    captureCheck(value, row.input, row.kind);
    assert.compareArray(log, ["write:initial", "read", "write:before", "read", "await", "resume", "write:after", "read"]);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));

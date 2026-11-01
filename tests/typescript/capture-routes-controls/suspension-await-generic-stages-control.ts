/*---
description: Control for suspension-await-generic-stages; the same stages read the binding directly.
features: [ts-capture-route-suspension, ts-closures, ts-function-types, ts-functions, ts-async, ts-generics, ts-unions, ts-arrays, ts-bigint]
flags: [async]
---*/
// Control: remove the reader closure; direct reads use the same live binding and occur at the same points.
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
async function genericStages<T>(seed: T, next: T, kind: string): Promise<void> {
  let value: T = seed; const log: string[] = ["write:initial"];
  log.push("read"); captureCheck(value, seed, "number");
  log.push("await:first"); await Promise.resolve(); log.push("resume:first");
  value = next; log.push("write:next"); log.push("read"); captureCheck(value, next, kind);
  log.push("await:second"); await Promise.resolve(); log.push("resume:second");
  value = seed; log.push("write:restore"); log.push("read"); captureCheck(value, seed, "number"); captureCheck(value, seed, "number");
  assert.compareArray(log, ["write:initial", "read", "await:first", "resume:first", "write:next", "read", "await:second", "resume:second", "write:restore", "read"]);
}
async function main(): Promise<void> { for (const row of samples) await genericStages<SuspensionValue>(1, row.input, row.kind); }
main().then(() => $DONE(), (error: unknown) => $DONE(error));

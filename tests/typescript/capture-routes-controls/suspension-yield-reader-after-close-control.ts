/*---
description: Control for suspension-yield-reader-after-close; the same stages read the binding directly.
features: [ts-capture-route-suspension, ts-closures, ts-function-types, ts-functions, ts-generators, ts-errors, ts-unions, ts-arrays, ts-bigint]
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
interface ClosingState { value: SuspensionValue; }
function captureCheck(actual: unknown, expected: unknown, kind: string): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, kind);
}
function* closingReader(state: ClosingState, next: SuspensionValue, log: string[]): Generator<ClosingState, void, void> {
  try { log.push("yield"); yield state; log.push("unexpected:resume"); }
  finally { state.value = next; log.push("write:finally"); }
}
for (const row of samples) {
  const state: ClosingState = { value: 1 }; const log: string[] = ["write:initial"];
  const iterator = closingReader(state, row.input, log); const first = iterator.next();
  if (first.done) throw new Error("expected a reader");
  const reader = first.value; log.push("read"); captureCheck(reader.value, 1, "number");
  assert.sameValue(iterator.return(undefined).done, true); log.push("read"); captureCheck(reader.value, row.input, row.kind);
  state.value = "finished"; log.push("write:after"); log.push("read"); captureCheck(reader.value, "finished", "string");
  captureCheck(state.value, "finished", "string"); assert.sameValue(iterator.next().done, true);
  assert.compareArray(log, ["write:initial", "yield", "read", "write:finally", "read", "write:after", "read"]);
}

/*---
description: Control for suspension-yield-number-after-completion; the same stages read the binding directly.
features: [ts-capture-route-suspension, ts-closures, ts-function-types, ts-functions, ts-generators, ts-interfaces, ts-numbers, ts-arrays]
---*/
// Control: remove the reader closure; direct reads use the same live binding and occur at the same points.
const samples: { before: number; after: number }[] = [
  { before: 1, after: 0.5 }, { before: -0, after: NaN },
  { before: NaN, after: 2147483648 }, { before: 2147483649, after: -0 },
  { before: -0.5, after: 0 }, { before: Infinity, after: -Infinity },
  { before: 0, after: 4294967296 }, { before: 2, after: -0.25 }
];
interface YieldNumberState { value: number; }
function captureCheck(actual: unknown, expected: unknown, kind: string): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, kind);
}
function* keepNumber(state: YieldNumberState, next: number, log: string[]): Generator<YieldNumberState, void, void> {
  log.push("yield"); yield state;
  state.value = next; log.push("write:resume"); log.push("finish");
}
for (const row of samples) {
  const state: YieldNumberState = { value: 1 }; const log: string[] = ["write:initial"];
  const iterator = keepNumber(state, row.before, log); const first = iterator.next();
  if (first.done) throw new Error("expected a reader");
  const reader = first.value; log.push("read"); captureCheck(reader.value, 1, "number");
  assert.sameValue(iterator.next().done, true); log.push("read"); captureCheck(reader.value, row.before, "number");
  state.value = row.after; log.push("write:after"); log.push("read"); captureCheck(reader.value, row.after, "number");
  captureCheck(state.value, row.after, "number"); assert.sameValue(iterator.next().done, true);
  assert.compareArray(log, ["write:initial", "yield", "read", "write:resume", "finish", "read", "write:after", "read"]);
}

/*---
description: A yielded numeric reader observes writes after its generator has completed.
features: [ts-capture-route-suspension, ts-closures, ts-function-types, ts-functions, ts-generators, ts-interfaces, ts-numbers, ts-arrays]
---*/
// Route: a generator parameter captured by an escaped reader over its live numeric field; node observes every write in order.
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
function* keepNumber(state: YieldNumberState, next: number, log: string[]): Generator<() => number, void, void> {
  const read: () => number = () => { log.push("read"); return state.value; };
  log.push("yield"); yield read;
  state.value = next; log.push("write:resume"); log.push("finish");
}
for (const row of samples) {
  const state: YieldNumberState = { value: 1 }; const log: string[] = ["write:initial"];
  const iterator = keepNumber(state, row.before, log); const first = iterator.next();
  if (first.done) throw new Error("expected a reader");
  const reader = first.value; captureCheck(reader(), 1, "number");
  assert.sameValue(iterator.next().done, true); captureCheck(reader(), row.before, "number");
  state.value = row.after; log.push("write:after"); captureCheck(reader(), row.after, "number");
  captureCheck(state.value, row.after, "number"); assert.sameValue(iterator.next().done, true);
  assert.compareArray(log, ["write:initial", "yield", "read", "write:resume", "finish", "read", "write:after", "read"]);
}

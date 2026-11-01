/*---
description: A yielded array reader retains identity and later mutations after generator completion.
features: [ts-capture-route-suspension, ts-closures, ts-function-types, ts-functions, ts-generators, ts-arrays, ts-numbers]
---*/
// Route: a generator array parameter captured by a retained reader; node observes every write in order.
const inputs: number[] = [0, -0, NaN, 0.25, 2147483648, 4294967297, Infinity, -Infinity];
function captureCheck(actual: unknown, expected: unknown, kind: string): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, kind);
}
function* keepArray(items: number[], log: string[]): Generator<() => number[], void, void> {
  const read: () => number[] = () => { log.push("read"); return items; };
  log.push("yield"); yield read; items.push(2); log.push("write:resume"); log.push("finish");
}
for (const input of inputs) {
  const items: number[] = [1]; const log: string[] = ["write:initial"];
  const iterator = keepArray(items, log); const first = iterator.next();
  if (first.done) throw new Error("expected a reader");
  const reader = first.value; const early = reader(); captureCheck(early, items, "object");
  assert.sameValue(early.length, 1); captureCheck(early[0], 1, "number");
  assert.sameValue(iterator.next().done, true);
  const resumed = reader(); captureCheck(resumed, items, "object"); assert.sameValue(resumed.length, 2); captureCheck(resumed[1], 2, "number");
  items[0] = input; log.push("write:after");
  const late = reader(); captureCheck(late, items, "object"); captureCheck(late[0], input, "number"); captureCheck(late[1], 2, "number");
  captureCheck(early[0], input, "number"); assert.sameValue(items.length, 2); assert.sameValue(iterator.next().done, true);
  assert.compareArray(log, ["write:initial", "yield", "read", "write:resume", "finish", "read", "write:after", "read"]);
}

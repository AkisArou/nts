/*---
description: "A labeled while break preserves the shared loop counter read by every earlier closure."
features: [ts-control-flow-routes, ts-control-flow-route-labels, ts-functions, ts-arrays, ts-objects, ts-type-aliases, ts-unions, ts-numbers, ts-strings, ts-null-undefined, ts-unknown, ts-typeof-operator, ts-closures, ts-arrow-functions, ts-function-types, ts-tuples, ts-literal-types, ts-iteration]
---*/
// Nested while loops select stop/walk and log union payloads and exits; node retains the current shared index after break and the final index after exhaustion.
type FlowValue = number | string | null | undefined | { id: number };
const first = { id: 7 }, second = { id: 7 };
const inputs: FlowValue[] = [-0, NaN, "", "text", undefined, null, first, second];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function inspect(input: FlowValue, mode: "stop" | "walk"): void {
  const log: unknown[] = [], readers: (() => [number, FlowValue])[] = []; let index = 0;
  outer: while (index < 2) {
    let step = 0; log.push("outer", index, input);
    while (step < 2) {
      readers.push(() => [index, input]); log.push("inner", index, step, input);
      if (mode === "stop") { log.push("break.outer", index, step, input); break outer; }
      log.push("keep", index, step, input); step++;
    }
    log.push("inner.exit", index, step, input); index++;
  }
  log.push("outer.exit", index, input); same(index, mode === "stop" ? 0 : 2); same(readers.length, mode === "stop" ? 1 : 4);
  const expected: unknown[] = [];
  if (mode === "stop") expected.push("outer", 0, input, "inner", 0, 0, input, "break.outer", 0, 0, input);
  else for (let i = 0; i < 2; i++) expected.push("outer", i, input, "inner", i, 0, input, "keep", i, 0, input, "inner", i, 1, input, "keep", i, 1, input, "inner.exit", i, 2, input);
  const finalIndex = mode === "stop" ? 0 : 2; expected.push("outer.exit", finalIndex, input);
  for (const read of readers) { const seen = read(); log.push("read", seen[0], seen[1]); expected.push("read", finalIndex, input); same(seen[0], finalIndex); same(seen[1], input); }
  assert.compareArray(log, expected);
}
const modes: ("stop" | "walk")[] = ["stop", "walk"];
for (const input of inputs) for (const mode of modes) inspect(input, mode);

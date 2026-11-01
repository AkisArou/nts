/*---
description: "A literal-mode continue skips the outer body tail but still runs its for update."
features: [ts-control-flow-routes, ts-control-flow-route-labels, ts-functions, ts-arrays, ts-objects, ts-type-aliases, ts-unions, ts-numbers, ts-strings, ts-null-undefined, ts-unknown, ts-typeof-operator, ts-closures, ts-arrow-functions, ts-function-types, ts-tuples, ts-literal-types, ts-iteration]
---*/
// Nested for loops select skip/visit, logging updates and delayed typed readers; node updates once after each outer continue and preserves body let copies.
type FlowValue = number | string | null | undefined | { id: number };
const first = { id: 7 }, second = { id: 7 };
const inputs: FlowValue[] = [-0, NaN, "", "text", undefined, null, first, second];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function inspect(input: FlowValue, mode: "skip" | "visit"): void {
  const log: unknown[] = [], readers: (() => [number, FlowValue])[] = [];
  outer: for (let i = 0; i < 2; i++, log.push("update", i, input)) {
    log.push("outer", i, input);
    for (let j = 0; j < 2; j++) {
      readers.push(() => [i, input]); log.push("inner", i, j, input);
      if (mode === "skip") { log.push("continue.outer", i, j, input); continue outer; }
      log.push("keep", i, j, input);
    }
    log.push("inner.exit", i, input, "tail", i, input);
  }
  log.push("outer.exit", input);
  const expected: unknown[] = [];
  for (let i = 0; i < 2; i++) {
    expected.push("outer", i, input, "inner", i, 0, input);
    if (mode === "skip") expected.push("continue.outer", i, 0, input);
    else expected.push("keep", i, 0, input, "inner", i, 1, input, "keep", i, 1, input, "inner.exit", i, input, "tail", i, input);
    expected.push("update", i + 1, input);
  }
  expected.push("outer.exit", input); same(readers.length, mode === "skip" ? 2 : 4);
  for (let slot = 0; slot < readers.length; slot++) {
    const seen = readers[slot](), index = mode === "skip" ? slot : Math.floor(slot / 2);
    log.push("read", seen[0], seen[1]); expected.push("read", index, input); same(seen[0], index); same(seen[1], input);
  }
  assert.compareArray(log, expected);
}
const modes: ("skip" | "visit")[] = ["skip", "visit"];
for (const input of inputs) for (const mode of modes) inspect(input, mode);

/*---
description: "A Map entry key selects an outer continue from a nested while loop and keeps captured entries."
features: [ts-control-flow-routes, ts-control-flow-route-labels, ts-functions, ts-arrays, ts-objects, ts-type-aliases, ts-unions, ts-numbers, ts-strings, ts-null-undefined, ts-unknown, ts-typeof-operator, ts-closures, ts-arrow-functions, ts-function-types, ts-tuples, ts-literal-types, ts-iteration, ts-map-set]
---*/
// For-of over Map<skip|keep,FlowValue> logs skipped tails and retained entry readers; node continues at the next entry and returns the keep value.
type FlowValue = number | string | null | undefined | { id: number };
const first = { id: 7 }, second = { id: 7 };
const inputs: FlowValue[] = [-0, NaN, "", "text", undefined, null, first, second];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function inspect(input: FlowValue): void {
  const log: unknown[] = [], readers: (() => ["skip" | "keep", FlowValue])[] = [];
  const entries = new Map<"skip" | "keep", FlowValue>([["skip", input], ["keep", second]]); let result: FlowValue = undefined;
  outer: for (const entry of entries) {
    log.push("entry", entry[0], entry[1]); let step = 0;
    while (step < 2) {
      readers.push(() => entry); log.push("inner", entry[0], step, entry[1]);
      if (entry[0] === "skip") { log.push("continue.outer", entry[0], step, entry[1]); continue outer; }
      result = entry[1]; log.push("keep", entry[0], step, result); step++;
    }
    log.push("inner.exit", entry[0], step, result, "tail", result);
  }
  log.push("outer.exit", result); same(result, second); same(readers.length, 3);
  const expected: unknown[] = ["entry", "skip", input, "inner", "skip", 0, input, "continue.outer", "skip", 0, input,
    "entry", "keep", second, "inner", "keep", 0, second, "keep", "keep", 0, second, "inner", "keep", 1, second, "keep", "keep", 1, second,
    "inner.exit", "keep", 2, second, "tail", second, "outer.exit", second];
  for (let slot = 0; slot < readers.length; slot++) {
    const seen = readers[slot](), key = slot === 0 ? "skip" : "keep", value = slot === 0 ? input : second;
    log.push("read", seen[0], seen[1]); expected.push("read", key, value); same(seen[0], key); same(seen[1], value);
  }
  assert.compareArray(log, expected);
}
for (const input of inputs) inspect(input);

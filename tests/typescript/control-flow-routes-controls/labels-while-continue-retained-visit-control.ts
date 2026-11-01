/*---
description: "Control for labels-while-continue-retained-visit; A continue from a nested for skips a while tail while closures retain body visits and the shared final counter."
features: [ts-control-flow-routes, ts-control-flow-route-labels, ts-functions, ts-arrays, ts-objects, ts-type-aliases, ts-unions, ts-numbers, ts-strings, ts-null-undefined, ts-unknown, ts-typeof-operator, ts-closures, ts-arrow-functions, ts-function-types, ts-tuples, ts-literal-types, ts-iteration]
---*/
// A skip/visit parameter controls the while back edge; node keeps each const visit, advances the shared counter and skips only the requested tails. The control propagates an explicit exit flag.
type FlowValue = number | string | null | undefined | { id: number };
const first = { id: 7 }, second = { id: 7 };
const inputs: FlowValue[] = [-0, NaN, "", "text", undefined, null, first, second];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function inspect(input: FlowValue, mode: "skip" | "visit"): void {
  const log: unknown[] = [], readers: (() => [number, number, FlowValue])[] = []; let index = 0;
  while (index < 2) {
    let skip = false; const visit = index++; log.push("outer", visit, index, input);
    for (let step = 0; step < 2; step++) {
      readers.push(() => [index, visit, input]); log.push("inner", visit, step, input);
      if (mode === "skip") { log.push("continue.outer", visit, step, input); skip = true; break; }
      log.push("keep", visit, step, input);
    }
    if (!skip) log.push("inner.exit", visit, input, "tail", visit, input);
  }
  log.push("outer.exit", index, input); same(index, 2); same(readers.length, mode === "skip" ? 2 : 4);
  const expected: unknown[] = [];
  for (let visit = 0; visit < 2; visit++) {
    expected.push("outer", visit, visit + 1, input, "inner", visit, 0, input);
    if (mode === "skip") expected.push("continue.outer", visit, 0, input);
    else expected.push("keep", visit, 0, input, "inner", visit, 1, input, "keep", visit, 1, input, "inner.exit", visit, input, "tail", visit, input);
  }
  expected.push("outer.exit", 2, input);
  for (let slot = 0; slot < readers.length; slot++) {
    const seen = readers[slot](), visit = mode === "skip" ? slot : Math.floor(slot / 2);
    log.push("read", seen[0], seen[1], seen[2]); expected.push("read", 2, visit, input); same(seen[0], 2); same(seen[1], visit); same(seen[2], input);
  }
  assert.compareArray(log, expected);
}
const modes: ("skip" | "visit")[] = ["skip", "visit"];
for (const input of inputs) for (const mode of modes) inspect(input, mode);

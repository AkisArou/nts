/*---
description: "Control for labels-dowhile-continue-condition; An outer do-while continue runs the outer test and skips the inner test and tails."
features: [ts-control-flow-routes, ts-control-flow-route-labels, ts-functions, ts-arrays, ts-objects, ts-type-aliases, ts-unions, ts-numbers, ts-strings, ts-null-undefined, ts-unknown, ts-typeof-operator, ts-closures, ts-arrow-functions, ts-function-types, ts-tuples, ts-literal-types, ts-iteration]
---*/
// Nested do-while loops decide on skip/visit and log both tests with union payloads; node tests the targeted loop after continue and retains the final shared index. The control propagates an explicit exit flag.
type FlowValue = number | string | null | undefined | { id: number };
const first = { id: 7 }, second = { id: 7 };
const inputs: FlowValue[] = [-0, NaN, "", "text", undefined, null, first, second];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function inspect(input: FlowValue, mode: "skip" | "visit"): void {
  const log: unknown[] = [], readers: (() => [number, FlowValue])[] = []; let index = 0;
  do {
    let skip = false; const visit = index++; let step = 0; log.push("outer", visit, input);
    do {
      readers.push(() => [index, input]); log.push("inner", visit, step, input);
      if (mode === "skip") { log.push("continue.outer", visit, step, input); skip = true; break; }
      log.push("keep", visit, step, input); step++;
    } while ((log.push("inner.test", visit, step, input), step < 2));
    if (!skip) log.push("inner.exit", visit, step, input, "tail", visit, input);
  } while ((log.push("outer.test", index, input), index < 2));
  log.push("outer.exit", index, input); same(index, 2); same(readers.length, mode === "skip" ? 2 : 4);
  const expected: unknown[] = [];
  for (let visit = 0; visit < 2; visit++) {
    expected.push("outer", visit, input, "inner", visit, 0, input);
    if (mode === "skip") expected.push("continue.outer", visit, 0, input);
    else expected.push("keep", visit, 0, input, "inner.test", visit, 1, input, "inner", visit, 1, input, "keep", visit, 1, input, "inner.test", visit, 2, input, "inner.exit", visit, 2, input, "tail", visit, input);
    expected.push("outer.test", visit + 1, input);
  }
  expected.push("outer.exit", 2, input);
  for (const read of readers) { const seen = read(); log.push("read", seen[0], seen[1]); expected.push("read", 2, input); same(seen[0], 2); same(seen[1], input); }
  assert.compareArray(log, expected);
}
const modes: ("skip" | "visit")[] = ["skip", "visit"];
for (const input of inputs) for (const mode of modes) inspect(input, mode);

/*---
description: "Control for labels-dowhile-break-skips-tests; A labeled do-while break skips both loop conditions and retains the shared current counter."
features: [ts-control-flow-routes, ts-control-flow-route-labels, ts-functions, ts-arrays, ts-objects, ts-type-aliases, ts-unions, ts-numbers, ts-strings, ts-null-undefined, ts-unknown, ts-typeof-operator, ts-closures, ts-arrow-functions, ts-function-types, ts-tuples, ts-literal-types, ts-iteration]
---*/
// Nested do-while loops select break/walk and log both tests with union payloads; node skips both tests on break and retains the final shared counter in earlier readers. The control propagates an exit flag through both loops.
type FlowValue = number | string | null | undefined | { id: number };
const first = { id: 7 }, second = { id: 7 };
const inputs: FlowValue[] = [-0, NaN, "", "text", undefined, null, first, second];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function inspect(input: FlowValue, mode: "break" | "walk"): void {
  const log: unknown[] = [], readers: (() => [number, FlowValue])[] = []; let index = 0;
  let stop = false;
  do {
    let step = 0; log.push("outer", index, input);
    do {
      readers.push(() => [index, input]); log.push("inner", index, step, input);
      if (mode === "break") { log.push("break.outer", index, step, input); stop = true; break; }
      log.push("keep", index, step, input); step++;
    } while ((log.push("inner.test", index, step, input), step < 2));
    if (stop) break;
    log.push("inner.exit", index, step, input); index++;
  } while ((log.push("outer.test", index, input), index < 2));
  log.push("outer.exit", index, input); same(index, mode === "break" ? 0 : 2); same(readers.length, mode === "break" ? 1 : 4);
  const expected: unknown[] = [];
  if (mode === "break") expected.push("outer", 0, input, "inner", 0, 0, input, "break.outer", 0, 0, input);
  else for (let visit = 0; visit < 2; visit++) expected.push("outer", visit, input, "inner", visit, 0, input, "keep", visit, 0, input,
    "inner.test", visit, 1, input, "inner", visit, 1, input, "keep", visit, 1, input, "inner.test", visit, 2, input,
    "inner.exit", visit, 2, input, "outer.test", visit + 1, input);
  const finalIndex = mode === "break" ? 0 : 2; expected.push("outer.exit", finalIndex, input);
  for (const read of readers) { const seen = read(); log.push("read", seen[0], seen[1]); expected.push("read", finalIndex, input); same(seen[0], finalIndex); same(seen[1], input); }
  assert.compareArray(log, expected);
}
const modes: ("break" | "walk")[] = ["break", "walk"];
for (const input of inputs) for (const mode of modes) inspect(input, mode);

/*---
description: "Control for labels-block-break-mutated-capture; A break crosses a while and for to leave a labeled block after mutating a captured union binding."
features: [ts-control-flow-routes, ts-control-flow-route-labels, ts-functions, ts-arrays, ts-objects, ts-type-aliases, ts-unions, ts-numbers, ts-strings, ts-null-undefined, ts-unknown, ts-typeof-operator, ts-closures, ts-arrow-functions, ts-function-types, ts-tuples, ts-literal-types, ts-iteration]
---*/
// A leave/finish parameter selects the block exit; node retains the block write in every earlier closure and skips both loop tails when leaving. The control propagates an explicit exit flag.
type FlowValue = number | string | null | undefined | { id: number };
const first = { id: 7 }, second = { id: 7 };
const inputs: FlowValue[] = [-0, NaN, "", "text", undefined, null, first, second];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function inspect(input: FlowValue, mode: "leave" | "finish"): void {
  const log: unknown[] = [], readers: (() => [number, FlowValue])[] = []; let result: FlowValue = input;
  {
    let leave = false;
    let value: FlowValue = input;
    for (let index = 0; index < 2; index++) {
      let step = 0; log.push("outer", index, value);
      while (step < 2) {
        readers.push(() => [index, value]); log.push("inner", index, step, value);
        if (mode === "leave") { value = second; result = value; log.push("break.block", index, step, value); leave = true; break; }
        log.push("keep", index, step, value); step++;
      }
      if (leave) break;
      log.push("inner.exit", index, value);
    }
    if (!leave) { log.push("outer.exit", value); value = second; result = value; log.push("block.tail", value); }
  }
  log.push("block.exit", result); same(result, second); same(readers.length, mode === "leave" ? 1 : 4);
  const expected: unknown[] = [];
  if (mode === "leave") expected.push("outer", 0, input, "inner", 0, 0, input, "break.block", 0, 0, second);
  else { for (let index = 0; index < 2; index++) expected.push("outer", index, input, "inner", index, 0, input, "keep", index, 0, input, "inner", index, 1, input, "keep", index, 1, input, "inner.exit", index, input); expected.push("outer.exit", input, "block.tail", second); }
  expected.push("block.exit", second);
  for (let slot = 0; slot < readers.length; slot++) {
    const seen = readers[slot](), index = mode === "leave" ? 0 : Math.floor(slot / 2);
    log.push("read", seen[0], seen[1]); expected.push("read", index, second); same(seen[0], index); same(seen[1], second);
  }
  assert.compareArray(log, expected);
}
const modes: ("leave" | "finish")[] = ["leave", "finish"];
for (const input of inputs) for (const mode of modes) inspect(input, mode);

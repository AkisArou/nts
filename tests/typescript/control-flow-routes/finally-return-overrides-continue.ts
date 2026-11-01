/*---
description: "A finally return overrides continue before the for update and later iterations."
features: [ts-control-flow-routes, ts-control-flow-route-finally, ts-functions, ts-arrays, ts-objects, ts-type-aliases, ts-unions, ts-numbers, ts-strings, ts-null-undefined, ts-unknown, ts-typeof-operator, ts-literal-types, ts-iteration, ts-closures, ts-errors]
---*/
// A return/continue parameter controls cleanup precedence over a pending back edge; node returns the union payload early or runs both updates and exits.
type FlowValue = number | string | null | undefined | { id: number };
const first = { id: 7 }, second = { id: 7 };
const inputs: FlowValue[] = [-0, NaN, "", "text", undefined, null, first, second];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function inspect(input: FlowValue, mode: "return" | "continue"): void {
  const log: unknown[] = []; let cleaned = 0;
  function run(): FlowValue {
    for (let index = 0; index < 2; index++, log.push("update", index, input)) {
      try { log.push("continue", index, input); continue; }
      finally {
        cleaned++; log.push("finally", index, input);
        if (mode === "return") { log.push("replace.return", index, input); return input; }
        log.push("preserve.continue", index, input);
      }
    }
    log.push("loop.exit", cleaned, second); return second;
  }
  const result = run(); log.push("result", result); same(result, mode === "return" ? input : second); same(cleaned, mode === "return" ? 1 : 2);
  const expected: unknown[] = [];
  if (mode === "return") expected.push("continue", 0, input, "finally", 0, input, "replace.return", 0, input);
  else { for (let index = 0; index < 2; index++) expected.push("continue", index, input, "finally", index, input, "preserve.continue", index, input, "update", index + 1, input); expected.push("loop.exit", 2, second); }
  expected.push("result", mode === "return" ? input : second); assert.compareArray(log, expected);
}
const modes: ("return" | "continue")[] = ["return", "continue"];
for (const input of inputs) for (const mode of modes) inspect(input, mode);

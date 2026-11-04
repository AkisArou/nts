/*---
description: "Control for assignments-simple-captured-let; Simple assignment overwrites a captured RHS mutation and returns the originally supplied RHS."
features: [ts-evaluation-order-routes, ts-evaluation-order-route-assignments, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-expressions, ts-closures, ts-typeof-operator]
---*/
// A captured let carries = through a typed closure; node retains RHS effects before its final write and returns the assigned value exactly. The control saves each step in order.
const log: string[] = [];
for (const input of [-5, -0, 8]) {
  let stored: number = 3;
  function rhs(): number { log.push(`rhs:${stored}`); stored = 99; log.push(`mutated:${stored}`); return input; }
  function run(): number { log.push("run"); const value = rhs();
    stored = value;
    return value; }
  log.length = 0; const result = run();
  assert.compareArray(log, ["run", "rhs:3", "mutated:99"]);
  assert.sameValue(result, input); assert.sameValue(typeof result, "number"); assert.sameValue(stored, input);
}

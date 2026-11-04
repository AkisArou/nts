/*---
description: "A captured compound assignment reads its binding before the RHS closure overwrites it."
features: [ts-evaluation-order-routes, ts-evaluation-order-route-assignments, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-expressions, ts-closures, ts-function-types, ts-typeof-operator]
---*/
// A typed closure carries captured *=; node multiplies the value read before RHS writes 100 and then overwrites that temporary mutation.
const log: string[] = [];
for (const initial of [-2, -0, 8]) {
  let stored: number = initial;
  function rhs(): number { log.push(`rhs:${stored}`); stored = 100; log.push(`mutated:${stored}`); return 3; }
  function update(): number { log.push("update"); return stored *= rhs(); }
  const invoke: () => number = update;
  log.length = 0; const result = invoke();
  assert.compareArray(log, ["update", `rhs:${initial}`, "mutated:100"]);
  assert.sameValue(result, initial * 3); assert.sameValue(typeof result, "number"); assert.sameValue(stored, initial * 3);
}

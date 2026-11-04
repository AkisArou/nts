/*---
description: "Compound static bigint multiplication saves the constructor, key and old field before RHS mutation."
features: [ts-evaluation-order-routes, ts-evaluation-order-route-assignments, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-expressions, ts-class, ts-static, ts-bigint, ts-closures, ts-literal-types, ts-typeof-operator]
---*/
// A typed constructor routes static *=; node reads bigint before the RHS changes that field and constructor selection, then stores the exact product.
const log: string[] = [];
class First { static value: bigint = 1n; }
class Second { static value: bigint = 90n; }
for (const initial of [-2n, 0n, 8n]) {
  First.value = initial; Second.value = 90n; let active: typeof First = First;
  function target(): typeof First { log.push("constructor"); return active; }
  function key(): "value" { log.push("key"); return "value"; }
  function rhs(): bigint { log.push(`rhs:${First.value}`); First.value = 100n; active = Second; return -3n; }
  function run(): bigint { log.push("run"); return target()[key()] *= rhs(); }
  log.length = 0; const result = run();
  assert.compareArray(log, ["run", "constructor", "key", `rhs:${initial}`]);
  assert.sameValue(result, initial * -3n); assert.sameValue(typeof result, "bigint");
  assert.sameValue(First.value, initial * -3n); assert.sameValue(Second.value, 90n); assert.sameValue(active, Second);
}

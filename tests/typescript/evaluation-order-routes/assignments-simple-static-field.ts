/*---
description: "Computed static assignment saves its constructor and key before the RHS switches constructors."
features: [ts-evaluation-order-routes, ts-evaluation-order-route-assignments, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-expressions, ts-class, ts-static, ts-closures, ts-literal-types, ts-typeof-operator]
---*/
// A typed constructor value carries a static = target; node logs constructor/key/RHS and writes the first class after selection switches.
const log: string[] = [];
class First { static id: string = "first"; static value: number = 1; }
class Second { static id: string = "second"; static value: number = 90; }
for (const value of [-5, 0, 8]) {
  First.value = 1; Second.value = 90; let active: typeof First = First;
  function target(): typeof First { log.push(`target:${active.id}`); return active; }
  function key(): "value" { log.push("key"); return "value"; }
  function rhs(): number { log.push("rhs"); First.value = 99; active = Second; return value; }
  function run(): number { log.push("run"); return target()[key()] = rhs(); }
  log.length = 0; const result = run();
  assert.compareArray(log, ["run", "target:first", "key", "rhs"]);
  assert.sameValue(result, value); assert.sameValue(typeof result, "number");
  assert.sameValue(First.value, value); assert.sameValue(Second.value, 90); assert.sameValue(active, Second);
}

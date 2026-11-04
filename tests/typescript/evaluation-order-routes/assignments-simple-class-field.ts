/*---
description: "Simple assignment retains a nested class-field receiver while its holder is replaced by the RHS."
features: [ts-evaluation-order-routes, ts-evaluation-order-route-assignments, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-expressions, ts-interfaces, ts-class, ts-class-fields, ts-objects, ts-closures, ts-this, ts-typeof-operator]
---*/
// A declared Holder.current field carries =; node selects its original Cell before RHS replaces the field and returns the saved RHS.
const log: string[] = [];
interface Cell { value: number; }
class Holder { current: Cell; constructor(current: Cell) { log.push("holder:new"); this.current = current; } }
for (const value of [-5, 0, 8]) {
  const original: Cell = { value: 1 }, replacement: Cell = { value: 90 }, holder = new Holder(original);
  function target(): Holder { log.push("target"); return holder; }
  function rhs(): number { log.push("rhs"); original.value = 99; holder.current = replacement; return value; }
  function run(): number { log.push("run"); return target().current.value = rhs(); }
  log.length = 0; const result = run();
  assert.compareArray(log, ["run", "target", "rhs"]);
  assert.sameValue(result, value); assert.sameValue(typeof result, "number");
  assert.sameValue(original.value, value); assert.sameValue(holder.current, replacement); assert.sameValue(replacement.value, 90);
}

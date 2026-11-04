/*---
description: "A Map lookup supplies the assignment receiver before RHS replaces the mapped value."
features: [ts-evaluation-order-routes, ts-evaluation-order-route-assignments, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-expressions, ts-interfaces, ts-map-set, ts-objects, ts-closures, ts-errors, ts-narrowing, ts-null-undefined, ts-typeof-operator]
---*/
// Map<string, Cell> carries a field = target; node reads its original value before RHS writes a replacement with set, then assigns the detached original Cell.
const log: string[] = [];
interface Cell { value: number; }
function target(table: Map<string, Cell>): Cell { log.push("get:slot"); const cell = table.get("slot"); if (cell === undefined) throw new Error("missing"); return cell; }
for (const value of [-5, 0, 8]) {
  const first: Cell = { value: 1 }, second: Cell = { value: 90 }, table: Map<string, Cell> = new Map([["slot", first]]);
  function rhs(): number { log.push("rhs"); first.value = 99; log.push("set:slot"); table.set("slot", second); return value; }
  function run(): number { log.push("run"); return target(table).value = rhs(); }
  log.length = 0; const result = run();
  assert.compareArray(log, ["run", "get:slot", "rhs", "set:slot"]);
  assert.sameValue(result, value); assert.sameValue(typeof result, "number");
  assert.sameValue(first.value, value); assert.sameValue(second.value, 90); assert.sameValue(table.get("slot"), second); assert.sameValue(table.size, 1);
}

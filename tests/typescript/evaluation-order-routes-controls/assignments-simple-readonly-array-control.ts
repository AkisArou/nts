/*---
description: "Control for assignments-simple-readonly-array; A readonly array routes a mutable accessor target before the index and RHS change traversal state."
features: [ts-evaluation-order-routes, ts-evaluation-order-route-assignments, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-expressions, ts-interfaces, ts-readonly, ts-class, ts-class-fields, ts-accessors, ts-objects, ts-this, ts-closures, ts-typeof-operator]
---*/
// A readonly Cell array carries =; node evaluates array/index/RHS once and writes the first cell while the selector advances to the second. The control saves each step in order.
const log: string[] = [];
interface Cell { id: string; raw: number; value: number; }
class Slot implements Cell {
  id: string; raw: number = 0;
  constructor(id: string) { log.push(`new:${id}`); this.id = id; }
  get value(): number { log.push(`get:${this.id}`); return this.raw; }
  set value(next: number) { log.push(`set:${this.id}:${next}`); this.raw = -next; }
}
for (const value of [-5, 0, 8]) {
  const first = new Slot("first"), second = new Slot("second"), cells: readonly Cell[] = [first, second]; let index = 0;
  function array(): readonly Cell[] { log.push("array"); return cells; }
  function key(): number { log.push(`index:${index}`); const selected = index; index = 1; return selected; }
  function rhs(): number { log.push(`rhs:${index}`); first.raw = 99; return value; }
  function run(): number { log.push("run"); const values = array();
    const index = key();
    const receiver = values[index];
    const value = rhs();
    receiver.value = value;
    return value; }
  log.length = 0; const result = run();
  assert.compareArray(log, ["run", "array", "index:0", "rhs:1", `set:first:${value}`]);
  assert.sameValue(result, value); assert.sameValue(typeof result, "number");
  assert.sameValue(first.raw, -value); assert.sameValue(second.raw, 0); assert.sameValue(index, 1);
  assert.sameValue(cells[0], first); assert.sameValue(cells[1], second); assert.sameValue(cells.length, 2);
}

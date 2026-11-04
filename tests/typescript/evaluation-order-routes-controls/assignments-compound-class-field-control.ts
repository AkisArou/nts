/*---
description: "Control for assignments-compound-class-field; Compound addition saves a class field before its RHS overwrites the field and replaces the receiver."
features: [ts-evaluation-order-routes, ts-evaluation-order-route-assignments, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-expressions, ts-class, ts-class-fields, ts-closures, ts-tuples, ts-this, ts-destructuring, ts-typeof-operator]
---*/
// A declared Cell.value field carries +=; node reads the original number before RHS mutations and writes their sum to the original Cell. The control saves each step in order.
const log: string[] = [];
class Cell { value: number; constructor(value: number) { log.push(`new:${value}`); this.value = value; } }
const rows: [number, number][] = [[-2, 3], [0, -4], [8, 5]];
for (const [initial, amount] of rows) {
  const first = new Cell(initial), second = new Cell(90); let active: Cell = first;
  function target(): Cell { log.push("target"); return active; }
  function rhs(): number { log.push(`rhs:${first.value}`); first.value = 100; active = second; log.push("mutated:100"); return amount; }
  function run(): number { log.push("run"); const receiver = target();
    const left = receiver.value;
    const right = rhs();
    const result = left + right;
    receiver.value = result;
    return result; }
  log.length = 0; const result = run();
  assert.compareArray(log, ["run", "target", `rhs:${initial}`, "mutated:100"]);
  assert.sameValue(result, initial + amount); assert.sameValue(typeof result, "number");
  assert.sameValue(first.value, initial + amount); assert.sameValue(second.value, 90); assert.sameValue(active, second);
}

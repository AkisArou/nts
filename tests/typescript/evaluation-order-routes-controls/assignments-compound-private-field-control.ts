/*---
description: "Control for assignments-compound-private-field; Compound private-field addition preserves the pre-RHS value and original receiver."
features: [ts-evaluation-order-routes, ts-evaluation-order-route-assignments, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-expressions, ts-class, ts-class-fields, ts-private-fields, ts-this, ts-closures, ts-arrow-functions, ts-typeof-operator]
---*/
// An instance method carries #value +=; node reads before a closure changes the private value and selected instance, then overwrites that mutation. The control saves each step in order.
const log: string[] = [];
class Cell {
  id: string; #value: number;
  constructor(id: string, value: number) { log.push(`new:${id}`); this.id = id; this.#value = value; }
  read(): number { log.push(`read:${this.id}`); return this.#value; }
  update(other: Cell, amount: number): number {
    log.push("update"); let active: Cell = this;
    const target = (): Cell => { log.push(`target:${active.id}`); return active; };
    const rhs = (): number => { log.push(`rhs:${this.#value}`); this.#value = 100; active = other; return amount; };
    const receiver = target();
    const left = receiver.#value;
    const right = rhs();
    const result = left + right;
    receiver.#value = result;
    return result;
  }
}
for (const initial of [-2, 0, 8]) {
  const first = new Cell("first", initial), second = new Cell("second", 90);
  log.length = 0; const result = first.update(second, 3); const left = first.read(); const right = second.read();
  assert.compareArray(log, ["update", "target:first", `rhs:${initial}`, "read:first", "read:second"]);
  assert.sameValue(result, initial + 3); assert.sameValue(typeof result, "number"); assert.sameValue(left, initial + 3); assert.sameValue(right, 90);
}

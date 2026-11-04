/*---
description: "Control for assignments-simple-private-field; Private-field assignment retains its branded receiver across an RHS that selects another instance."
features: [ts-evaluation-order-routes, ts-evaluation-order-route-assignments, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-expressions, ts-class, ts-class-fields, ts-private-fields, ts-this, ts-closures, ts-arrow-functions, ts-typeof-operator]
---*/
// A declared private field carries = through an instance method; node logs target before RHS and writes the original brand-bearing object. The control saves each step in order.
const log: string[] = [];
class Cell {
  id: string; #value: number;
  constructor(id: string, value: number) { log.push(`new:${id}`); this.id = id; this.#value = value; }
  read(): number { log.push(`read:${this.id}`); return this.#value; }
  assign(other: Cell, value: number): number {
    log.push("assign"); let active: Cell = this;
    const target = (): Cell => { log.push(`target:${active.id}`); return active; };
    const rhs = (): number => { log.push("rhs"); this.#value = 99; active = other; return value; };
    const receiver = target();
    const next = rhs();
    receiver.#value = next;
    return next;
  }
}
for (const value of [-5, 0, 8]) {
  const first = new Cell("first", 1), second = new Cell("second", 90);
  log.length = 0; const result = first.assign(second, value); const left = first.read(); const right = second.read();
  assert.compareArray(log, ["assign", "target:first", "rhs", "read:first", "read:second"]);
  assert.sameValue(result, value); assert.sameValue(typeof result, "number"); assert.sameValue(left, value); assert.sameValue(right, 90);
}

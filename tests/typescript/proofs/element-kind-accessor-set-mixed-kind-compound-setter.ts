/*---
description: A compound property assignment invokes a setter that adds an object to a numeric-seeded Set.
features: [ts-proof-element-kind, ts-route-accessor, ts-map-set, ts-functions, ts-iteration, ts-arrays, ts-unions, ts-class, ts-class-fields, ts-accessors, ts-objects, ts-closures, ts-expressions, ts-narrowing, ts-typeof-operator, ts-instanceof]
---*/
// Fact: only small integers are initially stored; all writers must license narrowing (docs/language/types.md, Decisions).
// Route: compound assignment reads the getter and sends its sum to the object-inserting setter.
class Packet {
  code: number;
  constructor(code: number) { this.code = code; }
}

function read(items: Set<number | Packet>): number | Packet {
  const values = Array.from(items);
  return values[values.length - 1];
}
function observe(n: number): number | Packet {
  const items = new Set<number | Packet>([1, 2]);
  const gate = {
    get amount(): number { return 0; },
    set amount(next: number) { if (next > 0) items.add(new Packet(next)); }
  };
  const assigned = gate.amount += n;
  assert.sameValue(assigned, n);
  return read(items);
}
for (const n of [-1, 0, 1, 3, 7]) {
  const result = observe(n);
  assert.sameValue(typeof result, n > 0 ? "object" : "number");
  if (result instanceof Packet) assert.sameValue(result.code, n);
  else assert.sameValue(result, 2);
}

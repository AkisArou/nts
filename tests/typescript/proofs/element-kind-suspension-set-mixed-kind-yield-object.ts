/*---
description: A suspended generator resumes over a Set that has gained an object entry.
features: [ts-proof-element-kind, ts-route-suspension, ts-map-set, ts-functions, ts-iteration, ts-arrays, ts-unions, ts-class, ts-class-fields, ts-generators, ts-narrowing, ts-typeof-operator, ts-instanceof]
---*/
// Fact: only small integers are initially stored; all writers must license narrowing (docs/language/types.md, Decisions).
// Route: the caller adds a Packet after the generator yields its original numeric last value.
class Packet {
  code: number;
  constructor(code: number) { this.code = code; }
}

function read(items: Set<number | Packet>): number | Packet {
  const values = Array.from(items);
  return values[values.length - 1];
}

function* pause(items: Set<number | Packet>): Generator<number | Packet, number | Packet, void> {
  yield read(items);
  return read(items);
}
function observe(n: number): number | Packet {
  const items = new Set<number | Packet>([1, 2]);
  const steps = pause(items), before = steps.next();
  assert.sameValue(before.done, false);
  assert.sameValue(before.value, 2);
  if (n > 0) items.add(new Packet(n));
  const after = steps.next();
  assert.sameValue(after.done, true);
  return after.value;
}
for (const n of [-1, 0, 1, 3, 7]) {
  const result = observe(n);
  assert.sameValue(typeof result, n > 0 ? "object" : "number");
  if (result instanceof Packet) assert.sameValue(result.code, n);
  else assert.sameValue(result, 2);
}

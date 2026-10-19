/*---
description: A member initialised by a run-time expression is evaluated once, in member order, and keeps a reverse mapping.
features: [ts-enum, ts-enum-computed, ts-enum-reverse-mapping]
---*/
const order: string[] = [];
function measure(name: string, value: number): number {
  order.push(name);
  return value;
}
enum Computed { A = measure("A", 7), B = measure("B", 8) }
assert.sameValue(Computed.A, 7);
assert.sameValue(Computed.B, 8);
assert.sameValue(Computed[8], "B");
assert.sameValue(order.join(","), "A,B");

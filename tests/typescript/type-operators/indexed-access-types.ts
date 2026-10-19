/*---
description: Indexed access types name a property's type and an array's element type, used to type functions over them.
features: [ts-type-operators, ts-indexed-access]
---*/
type Order = { id: number; lines: { sku: string; qty: number }[]; status: "open" | "shipped" };
type Line = Order["lines"][number];
type Status = Order["status"];
function quantity(line: Line): number {
  return line.qty;
}
function ship(order: Order): Status {
  order.status = "shipped";
  return order.status;
}
const order: Order = { id: 1, lines: [{ sku: "a", qty: 2 }, { sku: "b", qty: 3 }], status: "open" };
assert.sameValue(order.lines.map(quantity).reduce((a, b) => a + b, 0), 5);
assert.sameValue(ship(order), "shipped");

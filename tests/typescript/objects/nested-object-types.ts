/*---
description: An object type nesting objects and arrays is read and written at every level.
features: [ts-objects, ts-arrays]
---*/
type Order = { id: number; customer: { name: string; address: { city: string } }; lines: { sku: string; qty: number }[] };
const order: Order = {
  id: 7,
  customer: { name: "ann", address: { city: "oslo" } },
  lines: [{ sku: "a", qty: 2 }, { sku: "b", qty: 1 }],
};
order.customer.address.city = "bergen";
order.lines[1].qty += 4;
assert.sameValue(order.customer.address.city, "bergen");
assert.sameValue(order.lines.reduce((n, line) => n + line.qty, 0), 7);

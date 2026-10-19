/*---
description: An interface extending another requires both sets of members, and a value of it is usable as either.
features: [ts-interfaces, ts-interface-extends]
---*/
interface Named {
  title: string;
}
interface Priced extends Named {
  price: number;
}
function label(item: Named): string {
  return item.title;
}
function total(items: Priced[]): number {
  return items.reduce((sum, item) => sum + item.price, 0);
}
const items: Priced[] = [{ title: "pen", price: 2 }, { title: "ink", price: 5 }];
assert.sameValue(items.map(label).join("+"), "pen+ink");
assert.sameValue(total(items), 7);

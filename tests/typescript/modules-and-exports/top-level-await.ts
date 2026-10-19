/*---
description: A module may await at top level; the statements after it run once the promise settles.
features: [ts-modules, ts-async]
flags: [module]
---*/
const order: string[] = [];
async function load(): Promise<number> {
  order.push("load");
  return 42;
}
export const value = await load();
order.push("after");
assert.sameValue(value, 42);
assert.compareArray(order, ["load", "after"]);

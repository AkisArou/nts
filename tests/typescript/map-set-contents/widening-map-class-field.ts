/*---
description: A widened class field writes string contents later read through the original numeric Map.
features: [ts-map-set-contents, ts-contents-widening, ts-map-set, ts-functions, ts-iteration, ts-typeof-operator, ts-class, ts-class-fields, ts-objects, ts-structural-typing, ts-unions, ts-spread, ts-numbers]
---*/
// Write/read route: a widened class field writes and its original narrow holder reads; node keeps the exact contents and order.
class Holder {
  contents: Map<string, number>;
  constructor(contents: Map<string, number>) { this.contents = contents; }
}
function check(n: number): void {
  const holder = new Holder(new Map<string, number>([["keep", n]]));
  const writer: { contents: Map<string, number | string> } = holder;
  const text = "item:" + String(n);
  writer.contents.set("added", text);
  const value = holder.contents.get("added");
  assert.sameValue<unknown>(value, text);
  assert.sameValue(typeof value, "string");
  assert.sameValue(holder.contents.get("keep"), n);
  assert.sameValue(typeof holder.contents.get("keep"), "number");
  assert.compareArray([...holder.contents.keys()], ["keep", "added"]);
  assert.compareArray<unknown>([...holder.contents.values()], [n, text]);
  assert.sameValue(holder.contents.size, 2);
}
for (const n of [-0, NaN, 2147483649]) check(n);

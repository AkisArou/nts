/*---
description: A namespace holding only types has no object; a value of the same name is separate from it.
features: [ts-namespace, ts-declaration-merging]
---*/
namespace Units {
  export type Meters = number;
}
const Units = { scale: 100 };
const span: Units.Meters = 2;
assert.sameValue(span * Units.scale, 200);
assert.sameValue(Object.keys(Units).join(","), "scale");

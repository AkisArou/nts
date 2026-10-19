/*---
description: An object typed by a mapped type over literal keys has exactly those keys, each read as its own type.
features: [ts-literal-types, ts-mapped-types]
---*/
type Axis = "x" | "y" | "z";
const zero: { [K in Axis]: number } = { x: 0, y: 0, z: 0 };
const moved: { [K in Axis]: number } = { ...zero, y: 3 };
const axes: Axis[] = ["x", "y", "z"];
assert.sameValue(axes.map((axis) => moved[axis]).join(","), "0,3,0");

/*---
description: A declared base-class field preserves different ancestor answers for identical public shapes.
features: [ts-instanceof-routes, ts-instanceof-route-classes, ts-class, ts-class-fields, ts-inheritance, ts-structural-typing, ts-arrays, ts-tuples, ts-iteration, ts-objects, ts-functions, ts-instanceof]
---*/
// Root, sibling and equal-shaped values replace Holder.value; node answers from each actual chain, including the plain impostor.
class Root { value: number = 7; }
class Left extends Root {}
class Right extends Root {}
class Lookalike { value: number = 7; }
class Holder { value: Root; constructor(value: Root) { this.value = value; } }
const rows: [Root, boolean[]][] = [
  [new Right(), [true, false, true, false]], [new Left(), [true, true, false, false]],
  [new Root(), [true, false, false, false]], [new Lookalike(), [false, false, false, true]],
  [{ value: 7 }, [false, false, false, false]], [new Left(), [true, true, false, false]],
];
const holder = new Holder(rows[0][0]);
for (const [value, expected] of rows) {
  holder.value = value;
  const alias: Root = holder.value;
  const actual = [holder.value instanceof Root, holder.value instanceof Left, holder.value instanceof Right, holder.value instanceof Lookalike];
  assert.sameValue(alias, value); assert.sameValue(alias.value, 7); assert.compareArray(actual, expected);
}

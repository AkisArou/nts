/*---
description: A type parameter constrained to a nested generic reads through both levels and returns the subclass it was given.
features: [ts-generics, ts-generic-constraints, ts-class, ts-inheritance]
---*/
class Box<T> {
  constructor(public value: T) {}
}
class LabelledBox<T> extends Box<T> {
  label = "labelled";
}
function innermost<T extends Box<Box<number>>>(box: T): number {
  return box.value.value;
}
function keep<T extends Box<Box<number>>>(box: T): T {
  return box;
}
const labelled = new LabelledBox(new Box(8));
assert.sameValue(innermost(labelled), 8);
assert.sameValue(keep(labelled).label, "labelled");
assert.sameValue(innermost(new Box(new Box(-1))), -1);

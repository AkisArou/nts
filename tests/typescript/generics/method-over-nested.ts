/*---
description: A generic method instantiated at a nested generic threads boxes of boxes through typed steps.
features: [ts-generics, ts-class]
---*/
class Box<T> {
  constructor(public value: T) {}
}
class Pipeline {
  readonly kinds: string[] = [];
  run<T>(value: T, steps: Array<(current: T) => T>): T {
    let current = value;
    for (const step of steps) {
      current = step(current);
      this.kinds.push(typeof current);
    }
    return current;
  }
}
const pipeline = new Pipeline();
const bump = (b: Box<Box<number>>): Box<Box<number>> => new Box(new Box(b.value.value + 1));
const result = pipeline.run<Box<Box<number>>>(new Box(new Box(4)), [bump, bump]);
assert.sameValue(result.value.value, 6);
assert.sameValue(result.value instanceof Box, true);

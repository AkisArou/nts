/*---
description: A generic method instantiated at boolean threads a value through typed steps.
features: [ts-generics, ts-class]
---*/
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
const result = pipeline.run<boolean>(true, [(b) => !b, (b) => !b, (b) => !b]);
assert.sameValue(result, false);
assert.sameValue(pipeline.kinds.join(","), "boolean,boolean,boolean");

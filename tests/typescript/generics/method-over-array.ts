/*---
description: A generic method instantiated at an array type threads arrays through steps that copy and change them.
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
const start = [1, 2, 3];
const result = pipeline.run<number[]>(start, [(xs) => [...xs, xs.length], (xs) => xs.map((n) => n * 2)]);
assert.compareArray(result, [2, 4, 6, 6]);
assert.compareArray(start, [1, 2, 3]);
assert.sameValue(pipeline.kinds.join(","), "object,object");

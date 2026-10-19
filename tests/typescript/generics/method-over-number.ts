/*---
description: A generic method instantiated at number threads a value through typed steps.
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
const result = pipeline.run<number>(2, [(n) => n + 1, (n) => n * 2, (n) => n / 4]);
assert.sameValue(result, 1.5);
assert.sameValue(pipeline.kinds.join(","), "number,number,number");

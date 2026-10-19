/*---
description: A generic method instantiated at a function type threads functions through steps that wrap them.
features: [ts-generics, ts-class, ts-function-types]
---*/
type Unary = (n: number) => number;
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
const composed = pipeline.run<Unary>((n) => n + 1, [(f) => (n) => f(n) * 10, (f) => (n) => f(n) - 3]);
assert.sameValue(composed(4), 47);
assert.sameValue(pipeline.kinds.join(","), "function,function");

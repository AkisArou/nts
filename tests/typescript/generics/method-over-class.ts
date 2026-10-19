/*---
description: A generic method instantiated at a class threads instances through typed steps, keeping identity where a step returns its input.
features: [ts-generics, ts-class]
---*/
class Coin {
  constructor(public cents: number) {}
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
const doubled = new Coin(10);
const result = pipeline.run<Coin>(new Coin(5), [(c) => (c.cents === 5 ? doubled : c), (c) => c]);
assert.sameValue(result, doubled);
assert.sameValue(result.cents, 10);
assert.sameValue(pipeline.kinds.join(","), "object,object");

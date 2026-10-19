/*---
description: A generic method instantiated at string threads a value through typed steps.
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
const result = pipeline.run<string>("ab", [(s) => s + "!", (s) => s.toUpperCase(), (s) => s.repeat(2)]);
assert.sameValue(result, "AB!AB!");
assert.sameValue(pipeline.kinds.join(","), "string,string,string");

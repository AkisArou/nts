/*---
description: A generic method instantiated at a union threads a value whose member type changes between steps.
features: [ts-generics, ts-class, ts-unions, ts-narrowing]
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
const toggle = (v: number | string): number | string => (typeof v === "number" ? String(v * 2) : v.length);
const pipeline = new Pipeline();
const result = pipeline.run<number | string>(21, [toggle, toggle, toggle]);
assert.sameValue(result, "4");
assert.sameValue(pipeline.kinds.join(","), "string,number,string");

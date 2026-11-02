/*---
description: Static method values retain names and arities in typed tuple elements.
features: [ts-function-object-route-length-name, ts-functions, ts-arrays, ts-iteration, ts-tuples, ts-strings, ts-numbers, ts-objects, ts-function-types, ts-class, ts-static, ts-default-parameters, ts-rest-parameters]
---*/
// A tuple carries detached static methods; node retains the static property names and parameter counts after defaults and rest.
type Numeric = (a: number, b: number, c: number) => number;
class StaticMethods {
  static empty(): number { return 0; }
  static one(a: number): number { return a; }
  static three(a: number, b: number, c: number): number { return a + b + c; }
  static stopped(a: number, b = 2, c?: number): number { return a + b + (c ?? 0); }
  static tail(a: number, b: number, ...values: number[]): number { return a + b; }
}
type Entry = [number, Numeric];
function observe(entry: Entry): [string, number] { const target = entry[1]; return [target.name, target.length]; }
const targets: Entry[] = [[0, StaticMethods.empty], [1, StaticMethods.one], [2, StaticMethods.three], [3, StaticMethods.stopped], [4, StaticMethods.tail]];
const expected: [string, number][] = [["empty", 0], ["one", 1], ["three", 3], ["stopped", 1], ["tail", 2]];
let index = 0;
for (const target of targets) {
  const actual = observe(target), wanted = expected[index];
  assert.sameValue(actual[0], wanted[0]); assert.sameValue(actual[1], wanted[1]);
  assert.compareArray(actual, wanted); index++;
}
assert.sameValue(index, 5);

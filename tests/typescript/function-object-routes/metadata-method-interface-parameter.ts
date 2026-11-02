/*---
description: An interface method signature preserves each implementation arity and its property name.
features: [ts-function-object-route-length-name, ts-functions, ts-arrays, ts-iteration, ts-tuples, ts-strings, ts-numbers, ts-objects, ts-interfaces, ts-default-parameters, ts-rest-parameters]
---*/
// A Service parameter carries five consume methods with different formal parameters; node reports consume and the implementation arity.
interface Service { consume(a: number, b: number, c: number): number; }
function observe(service: Service): [string, number] { const target = service.consume; return [target.name, target.length]; }
const targets: Service[] = [
  { consume(): number { return 0; } },
  { consume(a: number): number { return a; } },
  { consume(a: number, b: number, c: number): number { return a + b + c; } },
  { consume(a: number, b = 4, c?: number): number { return a + b + (c ?? 0); } },
  { consume(a: number, ...tail: number[]): number { return a; } }
];
const expected: [string, number][] = [["consume", 0], ["consume", 1], ["consume", 3], ["consume", 1], ["consume", 1]];
let index = 0;
for (const target of targets) {
  const actual = observe(target), wanted = expected[index];
  assert.sameValue(actual[0], wanted[0]); assert.sameValue(actual[1], wanted[1]);
  assert.compareArray(actual, wanted); index++;
}
assert.sameValue(index, 5);

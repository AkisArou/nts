/*---
description: Explicit metadata record control for An interface method signature preserves each implementation arity and its property name.
features: [ts-function-object-route-length-name, ts-functions, ts-arrays, ts-iteration, ts-tuples, ts-strings, ts-numbers, ts-objects, ts-interfaces]
---*/
// Explicit records: A Service parameter carries five consume methods with different formal parameters; node reports consume and the implementation arity.
interface Metadata { label: string; arity: number; }
interface Service { consume: Metadata; }
function observe(service: Service): [string, number] { const target = service.consume; return [target.label, target.arity]; }
const targets: Service[] = [{ consume: { label: "consume", arity: 0 } }, { consume: { label: "consume", arity: 1 } }, { consume: { label: "consume", arity: 3 } }, { consume: { label: "consume", arity: 1 } }, { consume: { label: "consume", arity: 1 } }];
const expected: [string, number][] = [["consume", 0], ["consume", 1], ["consume", 3], ["consume", 1], ["consume", 1]];
let index = 0;
for (const target of targets) {
  const actual = observe(target), wanted = expected[index];
  assert.sameValue(actual[0], wanted[0]); assert.sameValue(actual[1], wanted[1]);
  assert.compareArray(actual, wanted); index++;
}
assert.sameValue(index, 5);

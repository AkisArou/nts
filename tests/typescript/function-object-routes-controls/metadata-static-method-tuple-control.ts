/*---
description: Explicit metadata record control for Static method values retain names and arities in typed tuple elements.
features: [ts-function-object-route-length-name, ts-functions, ts-arrays, ts-iteration, ts-tuples, ts-strings, ts-numbers, ts-objects, ts-interfaces, ts-class, ts-class-fields, ts-static]
---*/
// Explicit records: A tuple carries detached static methods; node retains the static property names and parameter counts after defaults and rest.
interface Metadata { label: string; arity: number; }
class StaticMethods {
  static empty: Metadata = { label: "empty", arity: 0 };
  static one: Metadata = { label: "one", arity: 1 };
  static three: Metadata = { label: "three", arity: 3 };
  static stopped: Metadata = { label: "stopped", arity: 1 };
  static tail: Metadata = { label: "tail", arity: 2 };
}
type Entry = [number, Metadata];
function observe(entry: Entry): [string, number] { const target = entry[1]; return [target.label, target.arity]; }
const targets: Entry[] = [[0, StaticMethods.empty], [1, StaticMethods.one], [2, StaticMethods.three], [3, StaticMethods.stopped], [4, StaticMethods.tail]];
const expected: [string, number][] = [["empty", 0], ["one", 1], ["three", 3], ["stopped", 1], ["tail", 2]];
let index = 0;
for (const target of targets) {
  const actual = observe(target), wanted = expected[index];
  assert.sameValue(actual[0], wanted[0]); assert.sameValue(actual[1], wanted[1]);
  assert.compareArray(actual, wanted); index++;
}
assert.sameValue(index, 5);

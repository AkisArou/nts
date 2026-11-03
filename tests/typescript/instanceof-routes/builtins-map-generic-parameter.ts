/*---
description: Generic Map operands preserve prototype membership across object and numeric type arguments.
features: [ts-instanceof-routes, ts-instanceof-route-builtins, ts-class, ts-functions, ts-generics, ts-map-set, ts-arrays, ts-tuples, ts-inheritance, ts-builtin-subclass, ts-iteration, ts-objects, ts-object-type, ts-unknown, ts-numbers, ts-arrow-functions, ts-instanceof]
---*/
// Map and ObjectMap candidates cross classify<T>; node follows their current chains and answers false for every numeric argument.
class ObjectMap extends Map<object, unknown> {}
function classify<T>(item: T): [boolean, boolean] {
  return [item instanceof Map, item instanceof ObjectMap];
}
const baseOnly: object = Object.create(Map.prototype), childOnly: object = Object.create(ObjectMap.prototype);
const samples: [object, boolean, boolean][] = [
  [new Map<number, string>([[1, "one"]]), true, false], [new ObjectMap(), true, true],
  [baseOnly, true, false], [childOnly, true, true], [Map.prototype, false, false], [ObjectMap.prototype, true, false],
  [new Set<number>(), false, false], [{ size: 0, get(): undefined { return undefined; } }, false, false], [() => 1, false, false]
];
for (const [item, isMap, isChild] of samples) {
  const answers = classify(item);
  assert.compareArray(answers, [isMap, isChild]);
}
const numbers: number[] = [-0, NaN, 1, Infinity];
for (const item of numbers) {
  const answers = classify(item);
  assert.compareArray(answers, [false, false]);
}

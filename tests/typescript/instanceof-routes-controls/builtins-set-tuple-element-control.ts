/*---
description: Set operands carried as tuple elements retain base and subclass chain membership. The control walks the actual prototype chain.
features: [ts-instanceof-routes, ts-instanceof-route-builtins, ts-class, ts-functions, ts-type-aliases, ts-map-set, ts-arrays, ts-tuples, ts-inheritance, ts-builtin-subclass, ts-iteration, ts-objects, ts-unknown, ts-narrowing, ts-typeof-operator]
---*/
// Set and ObjectSet candidates cross a SetRow tuple parameter; node separates real chains from size-shaped objects and each constructor prototype. The control walks prototypes explicitly.
function follows(value: unknown, prototype: object): boolean {
  let step: unknown = value;
  while ((typeof step === "object" && step !== null) || typeof step === "function") {
    step = Object.getPrototypeOf(step);
    if (step === prototype) return true;
  }
  return false;
}
class ObjectSet extends Set<unknown> {}
type SetRow = [candidate: unknown, isSet: boolean, isChild: boolean];
function classify(row: SetRow): [boolean, boolean] {
  return [follows(row[0], Set.prototype), follows(row[0], ObjectSet.prototype)];
}
const baseOnly: unknown = Object.create(Set.prototype), childOnly: unknown = Object.create(ObjectSet.prototype);
const samples: SetRow[] = [
  [new Set<number>([1]), true, false], [new ObjectSet([1, "x"]), true, true],
  [baseOnly, true, false], [childOnly, true, true], [Set.prototype, false, false], [ObjectSet.prototype, true, false],
  [new Map<number, number>(), false, false], [{ size: 0, has(): boolean { return false; } }, false, false], [1, false, false], [null, false, false]
];
for (const row of samples) {
  const answers = classify(row);
  assert.compareArray(answers, [row[1], row[2]]);
}

/*---
description: Array checks through an interface field follow base and subclass prototypes rather than array shape or internal slots. The control walks the actual prototype chain.
features: [ts-instanceof-routes, ts-instanceof-route-builtins, ts-class, ts-class-fields, ts-interfaces, ts-functions, ts-arrays, ts-tuples, ts-inheritance, ts-builtin-subclass, ts-iteration, ts-objects, ts-unknown, ts-arrow-functions, ts-narrowing, ts-typeof-operator]
---*/
// Array and NumberList candidates cross an ArrayRoute field; node matches exactly the prototypes on their chains, excluding each prototype itself. The control walks prototypes explicitly.
function follows(value: unknown, prototype: object): boolean {
  let step: unknown = value;
  while ((typeof step === "object" && step !== null) || typeof step === "function") {
    step = Object.getPrototypeOf(step);
    if (step === prototype) return true;
  }
  return false;
}
interface ArrayRoute { item: unknown; }
class NumberList extends Array<number> {}
class ArrayCarrier implements ArrayRoute {
  item: unknown;
  constructor(item: unknown) { this.item = item; }
}
function classify(route: ArrayRoute): [boolean, boolean] {
  const item = route.item;
  return [follows(item, Array.prototype), follows(item, NumberList.prototype)];
}
const baseOnly: unknown = Object.create(Array.prototype), childOnly: unknown = Object.create(NumberList.prototype);
const samples: [unknown, boolean, boolean][] = [
  [[], true, false], [new NumberList(1, 2), true, true], [baseOnly, true, false], [childOnly, true, true],
  [Array.prototype, false, false], [NumberList.prototype, true, false], [{ 0: 1, length: 1 }, false, false],
  [new Uint8Array([1]), false, false], [() => [], false, false], ["", false, false], [null, false, false]
];
for (const [item, isArray, isList] of samples) {
  const route: ArrayRoute = new ArrayCarrier(item), answers = classify(route);
  assert.compareArray(answers, [isArray, isList]); assert.sameValue(route.item, item);
}

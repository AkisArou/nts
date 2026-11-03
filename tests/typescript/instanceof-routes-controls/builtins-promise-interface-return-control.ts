/*---
description: Promise operands returned in an interface retain prototype membership without consulting thenables. The control walks the actual prototype chain.
features: [ts-instanceof-routes, ts-instanceof-route-builtins, ts-class, ts-functions, ts-interfaces, ts-arrays, ts-tuples, ts-inheritance, ts-builtin-subclass, ts-iteration, ts-objects, ts-unknown, ts-arrow-functions, ts-narrowing, ts-typeof-operator]
---*/
// Promise and NumberFuture candidates cross a PromiseRoute return; node matches their chains while leaving a thenable method uncalled. The control walks prototypes explicitly.
function follows(value: unknown, prototype: object): boolean {
  let step: unknown = value;
  while ((typeof step === "object" && step !== null) || typeof step === "function") {
    step = Object.getPrototypeOf(step);
    if (step === prototype) return true;
  }
  return false;
}
interface PromiseRoute { candidate: unknown; }
class NumberFuture extends Promise<number> {}
function carry(candidate: unknown): PromiseRoute { return { candidate }; }
let thenCalls = 0;
const thenable = { then(): void { thenCalls++; } };
const baseOnly: unknown = Object.create(Promise.prototype), childOnly: unknown = Object.create(NumberFuture.prototype);
const samples: [unknown, boolean, boolean][] = [
  [Promise.resolve(1), true, false], [new NumberFuture(resolve => resolve(2)), true, true],
  [baseOnly, true, false], [childOnly, true, true], [Promise.prototype, false, false], [NumberFuture.prototype, true, false],
  [thenable, false, false], [() => Promise.resolve(3), false, false], [null, false, false], [1, false, false]
];
for (const [candidate, isPromise, isChild] of samples) {
  const route = carry(candidate);
  const answers = [follows(route.candidate, Promise.prototype), follows(route.candidate, NumberFuture.prototype)];
  assert.compareArray(answers, [isPromise, isChild]); assert.sameValue(route.candidate, candidate);
}
assert.sameValue(thenCalls, 0);

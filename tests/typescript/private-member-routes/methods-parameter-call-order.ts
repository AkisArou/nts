/*---
description: A private method lookup fails before argument evaluation, while a valid receiver evaluates the argument before entering the body.
features: [ts-private-member-routes, ts-private-member-route-methods, ts-class, ts-class-fields, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-errors, ts-numbers, ts-interfaces, ts-unsound-bivariance, ts-inheritance, ts-tuples, ts-function-types, ts-private-fields]
---*/
// CallOwner receivers cross a widened invoke interface; node logs argument then body for valid objects and nothing for a missing private method.
const log: string[] = [];
class CallOwner {
  label: string = "same";
  #twice(value: number): number { log.push("body"); return value * 2; }
  static invoke(target: CallOwner, argument: () => number): number { return target.#twice(argument()); }
}
class Child extends CallOwner {}
interface Invoker { invoke(target: object, argument: () => number): number; }
const invoker: Invoker = CallOwner;
for (const value of [-0, 1, 3]) {
  const entries: [object, boolean][] = [[{ label: "same" }, false], [new Child(), true], [new CallOwner(), true]];
  for (const [target, valid] of entries) {
    log.length = 0;
    const argument = (): number => { log.push("argument"); return value; };
    if (valid) { assert.sameValue(invoker.invoke(target, argument), value * 2); assert.compareArray(log, ["argument", "body"]); }
    else { assert.throws(TypeError, () => invoker.invoke(target, argument)); assert.compareArray(log, []); }
  }
}

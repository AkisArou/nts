/*---
description: A returning base stamps a private method brand, sharing the method across targets and rejecting a repeated addition.
features: [ts-private-member-routes, ts-private-member-route-inheritance, ts-class, ts-class-fields, ts-arrays, ts-iteration, ts-objects, ts-errors, ts-functions, ts-inheritance, ts-static, ts-this, ts-this-parameter, ts-private-fields]
---*/
// MethodStamp instances are declared class-typed variables even when the base returns plain targets; node installs one shared method brand and rejects installing it twice.
class ReturnTarget { constructor(target: object) { return target; } }
class MethodStamp extends ReturnTarget {
  #identity(): object { return this; }
  static owns(target: object): boolean { return #identity in target; }
  static invoke(target: MethodStamp): object { return target.#identity(); }
  static method(target: MethodStamp): (this: object) => object { return target.#identity; }
}
let firstMethod: ((this: object) => object) | undefined;
const targets: object[] = [{ label: "same" }, { label: "same" }, [], () => 7];
for (const target of targets) {
  assert.sameValue(MethodStamp.owns(target), false);
  const stamped: MethodStamp = new MethodStamp(target), method = MethodStamp.method(stamped);
  assert.sameValue(stamped, target); assert.sameValue(MethodStamp.owns(target), true);
  assert.sameValue(MethodStamp.invoke(stamped), target); assert.sameValue(method.call(target), target);
  if (firstMethod === undefined) firstMethod = method; else assert.sameValue(method, firstMethod);
  const other = { label: "same" };
  assert.sameValue(MethodStamp.owns(other), false); assert.sameValue(method.call(other), other);
  assert.throws(TypeError, () => new MethodStamp(target));
  assert.sameValue(MethodStamp.owns(target), true); assert.sameValue(MethodStamp.invoke(stamped), target);
  assert.sameValue(MethodStamp.method(stamped), method);
}

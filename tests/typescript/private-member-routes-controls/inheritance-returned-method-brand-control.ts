/*---
description: A Map-backed control: A returning base stamps a private method brand, sharing the method across targets and rejecting a repeated addition.
features: [ts-private-member-routes, ts-private-member-route-inheritance, ts-class, ts-class-fields, ts-arrays, ts-iteration, ts-objects, ts-errors, ts-functions, ts-inheritance, ts-static, ts-this, ts-this-parameter, ts-map-set]
---*/
// MethodStamp instances are declared class-typed variables even when the base returns plain targets; node installs one shared method brand and rejects installing it twice. The control uses guarded Maps with the same observations.
class ReturnTarget { constructor(target: object) { return target; } }
const methods = new Map<object, (this: object) => object>(), shared = function(this: object): object { return this; };
class MethodStamp extends ReturnTarget {
  constructor(target: object) { super(target); if (methods.has(this)) throw new TypeError(); methods.set(this, shared); }
  static owns(target: object): boolean { return methods.has(target); }
  static invoke(target: MethodStamp): object { return MethodStamp.method(target).call(target); }
  static method(target: MethodStamp): (this: object) => object { if (!methods.has(target)) throw new TypeError(); const method = methods.get(target); if (method === undefined) throw new TypeError(); return method; }
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

/*---
description: A returning base stamps a private accessor brand whose getter and setter keep the target receiver and reject a duplicate addition.
features: [ts-private-member-routes, ts-private-member-route-inheritance, ts-class, ts-class-fields, ts-arrays, ts-iteration, ts-objects, ts-errors, ts-accessors, ts-functions, ts-inheritance, ts-static, ts-this, ts-this-parameter, ts-unknown, ts-private-fields]
---*/
// AccessorStamp instances pass through a declared class variable; node runs the accessor on the returned object in get/set/get order and throws before repeating its brand addition.
const log: unknown[] = [];
class ReturnTarget { constructor(target: object) { return target; } }
class AccessorStamp extends ReturnTarget {
  get #slot(): object { log.push("get", this); return this; }
  set #slot(value: object) { log.push("set", this, value); }
  static owns(target: object): boolean { return #slot in target; }
  static read(target: AccessorStamp): object { return target.#slot; }
  static write(target: AccessorStamp, value: object): void { target.#slot = value; }
}
const targets: object[] = [{ label: "same" }, { label: "same" }, [], () => 7];
for (const target of targets) {
  log.length = 0;
  assert.sameValue(AccessorStamp.owns(target), false);
  const stamped: AccessorStamp = new AccessorStamp(target), value = { target };
  assert.sameValue(stamped, target); assert.sameValue(AccessorStamp.owns(target), true);
  assert.sameValue(AccessorStamp.read(stamped), target); assert.sameValue(AccessorStamp.write(stamped, value), undefined);
  assert.sameValue(AccessorStamp.read(stamped), target);
  assert.compareArray(log, ["get", target, "set", target, value, "get", target]);
  assert.throws(TypeError, () => new AccessorStamp(target));
  assert.sameValue(AccessorStamp.owns(target), true);
  assert.compareArray(log, ["get", target, "set", target, value, "get", target]);
}

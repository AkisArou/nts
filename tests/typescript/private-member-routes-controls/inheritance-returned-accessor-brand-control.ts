/*---
description: A Map-backed control: A returning base stamps a private accessor brand whose getter and setter keep the target receiver and reject a duplicate addition.
features: [ts-private-member-routes, ts-private-member-route-inheritance, ts-class, ts-class-fields, ts-arrays, ts-iteration, ts-objects, ts-errors, ts-accessors, ts-functions, ts-inheritance, ts-static, ts-this, ts-this-parameter, ts-unknown, ts-map-set]
---*/
// AccessorStamp instances pass through a declared class variable; node runs the accessor on the returned object in get/set/get order and throws before repeating its brand addition. The control uses guarded Maps with the same observations.
const log: unknown[] = [];
class ReturnTarget { constructor(target: object) { return target; } }
const accessors = new Map<object, { get(this: object): object; set(this: object, value: object): void }>();
const shared = { get(this: object): object { log.push("get", this); return this; }, set(this: object, value: object): void { log.push("set", this, value); } };
class AccessorStamp extends ReturnTarget {
  constructor(target: object) { super(target); if (accessors.has(this)) throw new TypeError(); accessors.set(this, shared); }
  static owns(target: object): boolean { return accessors.has(target); }
  static read(target: AccessorStamp): object { if (!accessors.has(target)) throw new TypeError(); const pair = accessors.get(target); if (pair === undefined) throw new TypeError(); return pair.get.call(target); }
  static write(target: AccessorStamp, value: object): void { if (!accessors.has(target)) throw new TypeError(); const pair = accessors.get(target); if (pair === undefined) throw new TypeError(); pair.set.call(target, value); }
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

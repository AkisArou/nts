/*---
description: A generic constructor parameter preserves private accessor receiver, order and write results. Control with explicit constructor checks.
features: [ts-private-member-routes, ts-private-member-route-static, ts-class, ts-static, ts-functions, ts-arrays, ts-iteration, ts-errors, ts-inheritance, ts-generics, ts-generic-constraints, ts-typeof-type, ts-this, ts-tuples, ts-unknown]
---*/
// StaticAccess crosses a generic constructor parameter; node logs getter, setter and getter in order and refuses subclasses before any accessor body runs.
const log: unknown[] = [];
let secret: unknown = undefined;
function getCurrent(receiver: object): unknown {
  if (receiver !== StaticAccess) throw new TypeError(); log.push("get", receiver, secret);
  if (receiver !== StaticAccess) throw new TypeError(); return secret;
}
function setCurrent(receiver: object, value: unknown): void {
  if (receiver !== StaticAccess) throw new TypeError(); log.push("set", receiver, value); secret = value;
}
class StaticAccess {
  static store(value: unknown): unknown { if (this !== StaticAccess) throw new TypeError(); setCurrent(this, value); return value; }
  static exchange(value: unknown): [unknown, unknown] {
    if (this !== StaticAccess) throw new TypeError(); const old = getCurrent(this);
    if (this !== StaticAccess) throw new TypeError(); setCurrent(this, value);
    if (this !== StaticAccess) throw new TypeError(); return [old, getCurrent(this)];
  }
}
class StaticChild extends StaticAccess {}
function store<T extends typeof StaticAccess>(receiver: T, value: unknown): unknown { return receiver.store(value); }
function exchange<T extends typeof StaticAccess>(receiver: T, value: unknown): [unknown, unknown] { return receiver.exchange(value); }
let previous: unknown = undefined;
const values: unknown[] = [-0, NaN, "", undefined, { id: 1 }];
for (const value of values) {
  log.length = 0;
  assert.compareArray(exchange(StaticAccess, value), [previous, value]);
  assert.compareArray(log, ["get", StaticAccess, previous, "set", StaticAccess, value, "get", StaticAccess, value]);
  log.length = 0; assert.throws(TypeError, () => exchange(StaticChild, previous)); assert.compareArray(log, []);
  assert.throws(TypeError, () => store(StaticChild, previous)); assert.compareArray(log, []);
  assert.sameValue(store(StaticAccess, value), value); assert.compareArray(log, ["set", StaticAccess, value]);
  previous = value;
}

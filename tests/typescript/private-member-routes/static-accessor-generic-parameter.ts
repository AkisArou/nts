/*---
description: A generic constructor parameter preserves private accessor receiver, order and write results.
features: [ts-private-member-routes, ts-private-member-route-static, ts-class, ts-static, ts-functions, ts-arrays, ts-iteration, ts-errors, ts-class-fields, ts-accessors, ts-inheritance, ts-generics, ts-generic-constraints, ts-typeof-type, ts-this, ts-tuples, ts-unknown, ts-private-fields]
---*/
// StaticAccess crosses a generic constructor parameter; node logs getter, setter and getter in order and refuses subclasses before any accessor body runs.
const log: unknown[] = [];
class StaticAccess {
  static #value: unknown = undefined;
  static get #current(): unknown { log.push("get", this, this.#value); return this.#value; }
  static set #current(value: unknown) { log.push("set", this, value); this.#value = value; }
  static store(value: unknown): unknown { return this.#current = value; }
  static exchange(value: unknown): [unknown, unknown] { const old = this.#current; this.#current = value; return [old, this.#current]; }
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

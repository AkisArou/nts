/*---
description: Distinct same-description symbol keys select base getters through a typed receiver array. The control resolves the home prototype explicitly.
features: [ts-super-routes, ts-super-route-properties, ts-class, ts-inheritance, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-this, ts-unknown, ts-typeof-operator, ts-accessors, ts-class-fields, ts-override, ts-type-aliases, ts-unions, ts-symbols, ts-typeof-type, ts-computed-keys, ts-numbers]
---*/
// super[key] crosses a unique-symbol union parameter on an array element; node keeps symbol identity, one key evaluation and the derived receiver. The control uses explicit reflection with the same receiver.
function same(actual: unknown, expected: unknown): void { assert.sameValue(actual, expected); assert.sameValue(typeof actual, typeof expected); }
const log: unknown[] = [];
function checkLog(expected: unknown[]): void { assert.compareArray(log, expected); for (let i = 0; i < log.length; i++) same(log[i], expected[i]); }
const left: unique symbol = Symbol("slot"), right: unique symbol = Symbol("slot");
type Key = typeof left | typeof right;
function keyOf(receiver: object, key: Key): Key { log.push("key", receiver, key); return key; }
class Base {
  leftValue: unknown = undefined; rightValue: unknown = undefined;
  get [left](): unknown { log.push("Base.left", this, this.leftValue); return this.leftValue; }
  get [right](): unknown { log.push("Base.right", this, this.rightValue); return this.rightValue; }
}
class Child extends Base {
  override get [left](): unknown { log.push("Child.left", this); return "wrong left"; }
  override get [right](): unknown { log.push("Child.right", this); return "wrong right"; }
  read(key: Key): unknown { log.push("read", this, key); const name = keyOf(this, key), value: unknown = Reflect.get(Base.prototype, name, this); return value; }
}
class Further extends Child {}
class Sibling extends Child { override get [left](): unknown { log.push("Sibling.left", this); return "sibling"; } }
const keys: Key[] = [left, right], inputs: unknown[] = [-0, NaN, { id: 10 }];
for (const input of inputs) for (const key of keys) {
  const receivers: Child[] = [new Child(), new Further(), new Sibling()];
  for (const receiver of receivers) {
    receiver.leftValue = input; receiver.rightValue = "right payload"; log.length = 0;
    const expected: unknown = key === left ? input : "right payload";
    same(receiver.read(key), expected); same(Object.hasOwn(receiver, key), false);
    same(Object.hasOwn(Base.prototype, "leftValue"), false); same(Object.hasOwn(Base.prototype, "rightValue"), false);
    checkLog(["read", receiver, key, "key", receiver, key, key === left ? "Base.left" : "Base.right", receiver, expected]);
  }
}

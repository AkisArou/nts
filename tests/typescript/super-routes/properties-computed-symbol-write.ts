/*---
description: A typed symbol-key super assignment evaluates its key before its RHS and calls only the selected base setter.
features: [ts-super-routes, ts-super-route-properties, ts-class, ts-inheritance, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-this, ts-unknown, ts-typeof-operator, ts-accessors, ts-class-fields, ts-override, ts-type-aliases, ts-unions, ts-symbols, ts-typeof-type, ts-computed-keys, ts-numbers, ts-optional-chaining]
---*/
// super[key] = value crosses a Child-array element and a symbol-union parameter; node logs method, key, value, setter and writes only receiver storage.
function same(actual: unknown, expected: unknown): void { assert.sameValue(actual, expected); assert.sameValue(typeof actual, typeof expected); }
const log: unknown[] = [];
function checkLog(expected: unknown[]): void { assert.compareArray(log, expected); for (let i = 0; i < log.length; i++) same(log[i], expected[i]); }
const left: unique symbol = Symbol("slot"), right: unique symbol = Symbol("slot");
type Key = typeof left | typeof right;
function keyOf(receiver: object, key: Key): Key { log.push("key", receiver, key); return key; }
function valueOf(receiver: object, value: unknown): unknown { log.push("value", receiver, value); return value; }
class Base {
  leftValue: unknown = "left initial"; rightValue: unknown = "right initial";
  set [left](value: unknown) { log.push("Base.left", this, value); this.leftValue = value; }
  set [right](value: unknown) { log.push("Base.right", this, value); this.rightValue = value; }
}
class Child extends Base {
  override set [left](value: unknown) { log.push("Child.left", this, value); }
  override set [right](value: unknown) { log.push("Child.right", this, value); }
  write(key: Key, value: unknown): unknown { log.push("write", this, key, value); return super[keyOf(this, key)] = valueOf(this, value); }
}
class Further extends Child {}
class Sibling extends Child { override set [left](value: unknown) { log.push("Sibling.left", this, value); } }
const leftSetter: unknown = Object.getOwnPropertyDescriptor(Base.prototype, left)?.set, rightSetter: unknown = Object.getOwnPropertyDescriptor(Base.prototype, right)?.set;
const keys: Key[] = [left, right], inputs: unknown[] = [-0, NaN, { id: 11 }, Symbol("value")];
for (const input of inputs) for (const key of keys) {
  const receivers: Child[] = [new Child(), new Further(), new Sibling()];
  for (const receiver of receivers) {
    log.length = 0; same(receiver.write(key, input), input);
    same(receiver.leftValue, key === left ? input : "left initial"); same(receiver.rightValue, key === right ? input : "right initial");
    same(Object.hasOwn(receiver, left), false); same(Object.hasOwn(receiver, right), false);
    same(Object.hasOwn(Base.prototype, "leftValue"), false); same(Object.hasOwn(Base.prototype, "rightValue"), false);
    same(Object.getOwnPropertyDescriptor(Base.prototype, left)?.set, leftSetter); same(Object.getOwnPropertyDescriptor(Base.prototype, right)?.set, rightSetter);
    checkLog(["write", receiver, key, input, "key", receiver, key, "value", receiver, input, key === left ? "Base.left" : "Base.right", receiver, input]);
  }
}

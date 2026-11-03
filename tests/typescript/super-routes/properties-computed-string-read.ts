/*---
description: A typed string key is evaluated once before a super getter receives the current derived instance.
features: [ts-super-routes, ts-super-route-properties, ts-class, ts-inheritance, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-this, ts-unknown, ts-typeof-operator, ts-accessors, ts-class-fields, ts-interfaces, ts-override, ts-type-aliases, ts-unions, ts-strings, ts-numbers]
---*/
// super[key] crosses a Key parameter on an interface method; node selects the matching base getter once and ignores derived getters.
function same(actual: unknown, expected: unknown): void { assert.sameValue(actual, expected); assert.sameValue(typeof actual, typeof expected); }
const log: unknown[] = [];
function checkLog(expected: unknown[]): void { assert.compareArray(log, expected); for (let i = 0; i < log.length; i++) same(log[i], expected[i]); }
type Key = "left" | "right";
function keyOf(receiver: object, key: Key): Key { log.push("key", receiver, key); return key; }
class Base {
  leftValue: unknown = undefined; rightValue: unknown = undefined;
  get left(): unknown { log.push("Base.left", this, this.leftValue); return this.leftValue; }
  get right(): unknown { log.push("Base.right", this, this.rightValue); return this.rightValue; }
}
class Child extends Base {
  override get left(): unknown { log.push("Child.left", this); return "wrong left"; }
  override get right(): unknown { log.push("Child.right", this); return "wrong right"; }
  read(key: Key): unknown { log.push("read", this, key); return super[keyOf(this, key)]; }
}
class Further extends Child {}
class Sibling extends Child { override get left(): unknown { log.push("Sibling.left", this); return "sibling"; } }
interface Reader { read(key: Key): unknown; }
const keys: Key[] = ["left", "right"], inputs: unknown[] = [-0, NaN, { id: 9 }];
for (const input of inputs) for (const key of keys) for (const instance of [new Child(), new Further(), new Sibling()]) {
  instance.leftValue = input; instance.rightValue = "right payload"; const receiver: Reader = instance; log.length = 0;
  const expected: unknown = key === "left" ? input : "right payload";
  same(receiver.read(key), expected); same(Object.hasOwn(receiver, key), false);
  same(Object.hasOwn(Base.prototype, "leftValue"), false); same(Object.hasOwn(Base.prototype, "rightValue"), false);
  checkLog(["read", receiver, key, "key", receiver, key, key === "left" ? "Base.left" : "Base.right", receiver, expected]);
}

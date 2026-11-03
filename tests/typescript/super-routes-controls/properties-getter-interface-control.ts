/*---
description: A super getter reached through an interface ignores own shadows and receives the current derived object. The control resolves the home prototype explicitly.
features: [ts-super-routes, ts-super-route-properties, ts-class, ts-inheritance, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-this, ts-unknown, ts-typeof-operator, ts-accessors, ts-class-fields, ts-interfaces, ts-override, ts-numbers, ts-symbols, ts-strings, ts-optional-chaining]
---*/
// super.slot crosses a Reader variable; node returns the receiver payload, ignores its own shadow and records only the base getter. The control uses explicit reflection with the same receiver.
function same(actual: unknown, expected: unknown): void { assert.sameValue(actual, expected); assert.sameValue(typeof actual, typeof expected); }
const log: unknown[] = [];
function checkLog(expected: unknown[]): void { assert.compareArray(log, expected); for (let i = 0; i < log.length; i++) same(log[i], expected[i]); }
class Base {
  raw: unknown = undefined;
  get slot(): unknown { log.push("Base.get", this, this.raw); return this.raw; }
}
class Child extends Base {
  override get slot(): unknown { log.push("Child.get", this); return "child"; }
  read(): unknown { log.push("read", this); const value: unknown = Reflect.get(Base.prototype, "slot", this); return value; }
}
class Further extends Child {}
class Sibling extends Child { override get slot(): unknown { log.push("Sibling.get", this); return "sibling"; } }
interface Reader { raw: unknown; read(): unknown; }
const inputs: unknown[] = [-0, NaN, 17, "", false, { id: 4 }, Symbol("payload")];
for (const input of inputs) for (const instance of [new Child(), new Further(), new Sibling()]) {
  const receiver: Reader = instance; receiver.raw = input;
  Object.defineProperty(receiver, "slot", { value: "own shadow", configurable: true });
  log.length = 0; same(receiver.read(), input); same(receiver.raw, input);
  same(Object.hasOwn(receiver, "slot"), true); same(Object.getOwnPropertyDescriptor(receiver, "slot")?.value, "own shadow");
  same(Object.hasOwn(Base.prototype, "raw"), false); checkLog(["read", receiver, "Base.get", receiver, input]);
}

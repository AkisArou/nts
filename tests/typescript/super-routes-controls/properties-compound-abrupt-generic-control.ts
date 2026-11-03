/*---
description: Abrupt completion at each computed super compound-assignment stage stops every later stage and retains receiver state. The control resolves the home prototype explicitly.
features: [ts-super-routes, ts-super-route-properties, ts-class, ts-inheritance, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-this, ts-unknown, ts-typeof-operator, ts-accessors, ts-class-fields, ts-override, ts-generics, ts-generic-constraints, ts-type-aliases, ts-unions, ts-numbers, ts-expressions, ts-errors, ts-arrow-functions, ts-optional-chaining, ts-narrowing]
---*/
// super[key] += value crosses a constrained generic parameter; node propagates ReferenceError, RangeError, SyntaxError or TypeError with the exact reached-stage log. The control uses explicit reflection with the same receiver.
function same(actual: unknown, expected: unknown): void { assert.sameValue(actual, expected); assert.sameValue(typeof actual, typeof expected); }
const log: unknown[] = [];
function checkLog(expected: unknown[]): void { assert.compareArray(log, expected); for (let i = 0; i < log.length; i++) same(log[i], expected[i]); }
type Stage = "none" | "key" | "get" | "value" | "set";
class Base {
  raw: number = 4; stage: Stage = "none";
  get slot(): number { log.push("Base.get", this, this.raw); if (this.stage === "get") throw new RangeError("get"); return this.raw; }
  set slot(value: number) { log.push("Base.set", this, value); if (this.stage === "set") throw new TypeError("set"); this.raw = value; }
}
function keyOf(receiver: Base): "slot" { log.push("key", receiver); if (receiver.stage === "key") throw new ReferenceError("key"); return "slot"; }
function valueOf(receiver: Base, value: number): number { log.push("value", receiver, value); if (receiver.stage === "value") throw new SyntaxError("value"); return value; }
class Child extends Base {
  override get slot(): number { log.push("Child.get", this); return 100; }
  override set slot(value: number) { log.push("Child.set", this, value); }
  add(value: number): number { log.push("add", this, value); const name = keyOf(this), old: unknown = Reflect.get(Base.prototype, name, this);
    if (typeof old !== "number") throw new TypeError("number");
    const next = old + valueOf(this, value); if (!Reflect.set(Base.prototype, name, next, this)) throw new TypeError("set"); return next; }
}
class Further extends Child {}
class Sibling extends Child { override get slot(): number { log.push("Sibling.get", this); return 200; } }
function add<T extends Child>(receiver: T, value: number): number { return receiver.add(value); }
const original: PropertyDescriptor | undefined = Object.getOwnPropertyDescriptor(Base.prototype, "slot");
const stages: Stage[] = ["none", "key", "get", "value", "set"];
for (const stage of stages) for (const receiver of [new Child(), new Further(), new Sibling()]) {
  receiver.stage = stage; log.length = 0;
  if (stage === "key") assert.throws(ReferenceError, () => add(receiver, 5));
  else if (stage === "get") assert.throws(RangeError, () => add(receiver, 5));
  else if (stage === "value") assert.throws(SyntaxError, () => add(receiver, 5));
  else if (stage === "set") assert.throws(TypeError, () => add(receiver, 5));
  else same(add(receiver, 5), 9);
  same(receiver.raw, stage === "none" ? 9 : 4); same(Object.hasOwn(receiver, "slot"), false);
  same(Object.hasOwn(receiver, "raw"), true); same(Object.hasOwn(Base.prototype, "raw"), false);
  same(Object.getOwnPropertyDescriptor(Base.prototype, "slot")?.get, original?.get); same(Object.getOwnPropertyDescriptor(Base.prototype, "slot")?.set, original?.set);
  const expected: unknown[] = ["add", receiver, 5, "key", receiver];
  if (stage !== "key") expected.push("Base.get", receiver, 4);
  if (stage === "none" || stage === "value" || stage === "set") expected.push("value", receiver, 5);
  if (stage === "none" || stage === "set") expected.push("Base.set", receiver, 9);
  checkLog(expected);
}

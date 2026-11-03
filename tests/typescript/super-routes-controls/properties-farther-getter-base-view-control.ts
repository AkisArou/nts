/*---
description: A super getter search crosses an empty prototype level while preserving the base-view receiver. The control resolves the home prototype explicitly.
features: [ts-super-routes, ts-super-route-properties, ts-class, ts-inheritance, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-this, ts-unknown, ts-typeof-operator, ts-accessors, ts-class-fields, ts-override, ts-numbers, ts-symbols]
---*/
// super.slot crosses a Child parameter holding three runtime classes; node reaches Grand through Gap and keeps the actual receiver. The control uses explicit reflection with the same receiver.
function same(actual: unknown, expected: unknown): void { assert.sameValue(actual, expected); assert.sameValue(typeof actual, typeof expected); }
const log: unknown[] = [];
function checkLog(expected: unknown[]): void { assert.compareArray(log, expected); for (let i = 0; i < log.length; i++) same(log[i], expected[i]); }
class Grand {
  raw: unknown = undefined;
  get slot(): unknown { log.push("Grand.get", this, this.raw); return this.raw; }
}
class Gap extends Grand {}
class Child extends Gap {
  override get slot(): unknown { log.push("Child.get", this); return "child"; }
  read(): unknown { log.push("read", this); const value: unknown = Reflect.get(Gap.prototype, "slot", this); return value; }
}
class Further extends Child {}
class Sibling extends Child { override get slot(): unknown { log.push("Sibling.get", this); return "sibling"; } }
function read(receiver: Child): unknown { log.push("route", receiver); return receiver.read(); }
const inputs: unknown[] = [-0, NaN, 23, { id: 6 }, Symbol("farther")];
for (const input of inputs) for (const receiver of [new Child(), new Further(), new Sibling()]) {
  receiver.raw = input; log.length = 0;
  same(read(receiver), input); same(receiver.raw, input); same(Object.hasOwn(receiver, "slot"), false);
  same(Object.hasOwn(Gap.prototype, "slot"), false); same(Object.hasOwn(Grand.prototype, "slot"), true);
  same(Object.hasOwn(Grand.prototype, "raw"), false); checkLog(["route", receiver, "read", receiver, "Grand.get", receiver, input]);
}

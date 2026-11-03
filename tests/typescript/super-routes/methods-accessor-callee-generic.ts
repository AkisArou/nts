/*---
description: A generic call to super through a getter obtains the callee before arguments and calls it with the receiver.
features: [ts-super-routes, ts-super-route-methods, ts-class, ts-inheritance, ts-class-fields, ts-override, ts-this, ts-functions, ts-arrays, ts-unknown, ts-accessors, ts-function-types, ts-this-parameter, ts-generics, ts-generic-constraints, ts-typeof-operator]
---*/
// super.m(argument) through a generic parameter; node reads the base getter once before the argument and preserves this for the returned call.
const log: unknown[] = [];
type Method = (this: Base, value: unknown) => unknown;
class Base {
  seed: unknown = "base";
  get m(): Method {
    log.push("get", this);
    return function(this: Base, value: unknown): unknown { log.push("call", this, value, this.seed); return value; };
  }
}
function argument(value: unknown): unknown { log.push("argument", value); return value; }
class Derived extends Base {
  override seed: unknown = "derived";
  invoke(value: unknown): unknown { log.push("invoke", this, value); return super.m(argument(value)); }
}
class Further extends Derived { override seed: unknown = "further"; override get m(): Method { log.push("wrong-get", this); return function(): unknown { return "wrong"; }; } }
class Sibling extends Further { override seed: unknown = "sibling"; }
function invoke<T extends Derived>(receiver: T, value: unknown): unknown { return receiver.invoke(value); }
for (const receiver of [new Derived(), new Further(), new Sibling()]) for (const value of [-0, NaN, "text", { token: 8 }]) {
  log.length = 0; const result = invoke(receiver, value);
  assert.sameValue(result, value); assert.sameValue(typeof result, typeof value);
  assert.compareArray(log, ["invoke", receiver, value, "get", receiver, "argument", value, "call", receiver, value, receiver.seed]);
}

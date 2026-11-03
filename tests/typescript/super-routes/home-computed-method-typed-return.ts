/*---
description: A returned literal method evaluates its computed key once, gets a base method with the current receiver, then evaluates its argument and calls it.
features: [ts-super-routes, ts-super-route-home, ts-objects, ts-interfaces, ts-function-types, ts-functions, ts-accessors, ts-computed-keys, ts-literal-types, ts-this, ts-this-parameter, ts-arrays, ts-iteration, ts-unknown, ts-typeof-operator]
---*/
// super[key] crosses a declared callable return; node logs home, key, the base getter, argument and base call in that order with the same receiver.
interface State { raw: number; seen: number; }
type Method = (this: State, value: number) => number;
const log: unknown[] = [];
const base = { get run(): Method { log.push("get", this); return function(this: State, value: number): number {
  log.push("base", this, value); this.seen = value; return this.raw + value;
}; } };
const home = { __proto__: base,
  invoke(this: State, name: "run", value: number): number { log.push("home", this, name, value); return super[key(name)](argument(value)); } };
function key(name: "run"): "run" { log.push("key", name); return name; }
function argument(value: number): number { log.push("argument", value); return value; }
function saved(): (this: State, name: "run", value: number) => number { return home.invoke; }
const invoke = saved(), receivers: State[] = [{ raw: 10, seen: 0 }, { raw: 20, seen: 0 }];
for (const input of [-2, -0, 2.5]) for (const receiver of receivers) {
  log.length = 0;
  const result = invoke.call(receiver, "run", input);
  assert.sameValue(result, receiver.raw + input); assert.sameValue(typeof result, "number");
  assert.sameValue(receiver.seen, input); assert.sameValue(typeof receiver.seen, "number");
  assert.sameValue(Object.hasOwn(base, "seen"), false);
  assert.compareArray(log, ["home", receiver, "run", input, "key", "run", "get", receiver, "argument", input, "base", receiver, input]);
}

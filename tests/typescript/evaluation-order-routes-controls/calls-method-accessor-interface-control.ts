/*---
description: "Control for calls-method-accessor-interface; A method getter is read before arguments replace its backing function through an interface."
features: [ts-evaluation-order-routes, ts-evaluation-order-route-calls, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-interfaces, ts-class, ts-class-fields, ts-accessors, ts-this, ts-function-types, ts-type-aliases, ts-objects, ts-template-literals, ts-typeof-operator, ts-this-parameter]
---*/
// An interface carries two class layouts and an object accessor; node gets the old method, runs both arguments and calls that old method with the updated receiver. The control uses ordered temporaries.
const log: string[] = [];
type Method = (this: Host, a: number, b: number) => number;
interface Host { label: string; value: number; current: Method; method: Method; }
function old(this: Host, a: number, b: number): number { log.push(`old:${this.label}:${this.value}:${a}:${b}`); return this.value * 100 + a * 10 + b; }
function newer(this: Host, a: number, b: number): number { log.push(`new:${this.label}:${a}:${b}`); return -99; }
class Alpha implements Host { label: string = "A"; value: number = 0; current: Method = old; get method(): Method { log.push(`get:${this.label}`); return this.current; } set method(fn: Method) { log.push(`set:${this.label}`); this.current = fn; } }
class Beta implements Host { padding: string = "wide"; label: string = "B"; value: number = 0; current: Method = old; get method(): Method { log.push(`get:${this.label}`); return this.current; } set method(fn: Method) { log.push(`set:${this.label}`); this.current = fn; } }
function first(host: Host, n: number): number { log.push(`first:${n}`); host.method = newer; host.value = n; return n + 1; }
function second(host: Host): number { log.push(`second:${host.value}`); return host.value + 2; }
function run(host: Host, n: number): number {
  log.push("run");
  const receiver = host;
  const fn = receiver.method;
  const a = first(host, n);
  const b = second(host);
  return fn.call(receiver, a, b);
}
const hosts: Host[] = [new Alpha(), new Beta(), { label: "O", value: 0, current: old, get method(): Method { log.push(`get:${this.label}`); return this.current; }, set method(fn: Method) { log.push(`set:${this.label}`); this.current = fn; } }];
for (const host of hosts) for (const n of [0, 3, -2]) {
  log.length = 0; host.value = 0; host.current = old; const result = run(host, n);
  assert.compareArray(log, ["run", `get:${host.label}`, `first:${n}`, `set:${host.label}`, `second:${n}`, `old:${host.label}:${n}:${n + 1}:${n + 2}`]);
  assert.sameValue(result, n * 100 + (n + 1) * 10 + n + 2); assert.sameValue(typeof result, "number"); assert.sameValue(host.value, n); assert.sameValue(host.current, newer);
}

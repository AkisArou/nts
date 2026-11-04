/*---
description: "Control for calls-tuple-callee; A tuple element callee is read before an argument replaces that same element."
features: [ts-evaluation-order-routes, ts-evaluation-order-route-calls, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-tuples, ts-type-aliases, ts-function-types, ts-this, ts-template-literals, ts-this-parameter]
---*/
// A declared tuple carries a function and mutable number; node calls the old function with the tuple as this after the first argument replaces its function and value. The control uses ordered temporaries.
const log: string[] = [];
type Slots = [Handler, number];
type Handler = (this: Slots, a: number, b: number) => number;
function old(this: Slots, a: number, b: number): number { log.push(`old:${this[1]}:${a}:${b}`); return this[1] * 100 + a * 10 + b; }
function newer(this: Slots, a: number, b: number): number { log.push(`new:${this[1]}:${a}:${b}`); return -100; }
function first(slot: Slots, n: number): number { log.push(`first:${n}`); slot[0] = newer; slot[1] = n; return n + 1; }
function second(slot: Slots): number { log.push(`second:${slot[1]}`); return slot[1] + 2; }
function run(slot: Slots, n: number): number {
  log.push("run");
  const receiver = slot;
  const fn = receiver[0];
  const a = first(slot, n);
  const b = second(slot);
  return fn.call(receiver, a, b);
}
for (const n of [0, 3, -2]) {
  const slot: Slots = [old, 9]; log.length = 0; const result = run(slot, n);
  assert.compareArray(log, ["run", `first:${n}`, `second:${n}`, `old:${n}:${n + 1}:${n + 2}`]);
  assert.sameValue(result, n * 100 + (n + 1) * 10 + n + 2); assert.sameValue(slot[0], newer); assert.sameValue(slot[1], n);
}

/*---
description: "Control for calls-readonly-array-callee; A readonly function-array view keeps the selected callee across a write through its mutable alias."
features: [ts-evaluation-order-routes, ts-evaluation-order-route-calls, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-readonly, ts-type-aliases, ts-function-types, ts-this, ts-closures, ts-template-literals, ts-this-parameter]
---*/
// A readonly array carries the call target; node retains its original function while an argument overwrites the aliased array and later arguments read updated state. The control uses ordered temporaries.
const log: string[] = [];
type Handler = (this: readonly Handler[], a: number, b: number) => number;
let state = 0;
function old(this: readonly Handler[], a: number, b: number): number { log.push(`old:${this[0] === newer}:${state}:${a}:${b}`); return state * 100 + a * 10 + b; }
function newer(this: readonly Handler[], a: number, b: number): number { log.push(`new:${a}:${b}`); return -100; }
function first(backing: Handler[], n: number): number { log.push(`first:${n}`); backing[0] = newer; state = n; return n + 1; }
function second(): number { log.push(`second:${state}`); return state + 2; }
function run(view: readonly Handler[], backing: Handler[], n: number): number {
  log.push("run");
  const receiver = view;
  const fn = receiver[0];
  const a = first(backing, n);
  const b = second();
  return fn.call(receiver, a, b);
}
for (const n of [0, 4, -2]) {
  const backing: Handler[] = [old], view: readonly Handler[] = backing; state = 9; log.length = 0; const result = run(view, backing, n);
  assert.compareArray(log, ["run", `first:${n}`, `second:${n}`, `old:true:${n}:${n + 1}:${n + 2}`]);
  assert.sameValue(result, n * 100 + (n + 1) * 10 + n + 2); assert.sameValue(view, backing); assert.sameValue(view[0], newer); assert.sameValue(state, n);
}

/*---
description: "Control for calls-captured-let-callee; A captured function binding is read before an argument reassigns it."
features: [ts-evaluation-order-routes, ts-evaluation-order-route-calls, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-closures, ts-type-aliases, ts-function-types, ts-template-literals]
---*/
// A typed captured let holds the callee; node runs its old function after the first argument replaces it and the second reads updated captured state. The control uses ordered temporaries.
const log: string[] = [];
type Handler = (a: number, b: number) => number;
let state = 0;
function old(a: number, b: number): number { log.push(`old:${state}:${a}:${b}`); return state * 100 + a * 10 + b; }
function newer(a: number, b: number): number { log.push(`new:${a}:${b}`); return -100; }
let current: Handler = old;
function first(n: number): number { log.push(`first:${n}`); current = newer; state = n; return n + 1; }
function second(): number { log.push(`second:${state}`); return state + 2; }
function run(n: number): number {
  log.push("run");
  const fn = current;
  const a = first(n);
  const b = second();
  return fn(a, b);
}
for (const n of [0, 3, -2]) {
  current = old; state = 9; log.length = 0; const result = run(n);
  assert.compareArray(log, ["run", `first:${n}`, `second:${n}`, `old:${n}:${n + 1}:${n + 2}`]);
  assert.sameValue(result, n * 100 + (n + 1) * 10 + n + 2); assert.sameValue(current, newer); assert.sameValue(state, n);
}

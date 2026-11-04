/*---
description: "A function returned from a typed Map is captured before an argument replaces that entry."
features: [ts-evaluation-order-routes, ts-evaluation-order-route-calls, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-map-set, ts-type-aliases, ts-function-types, ts-this, ts-closures, ts-unknown, ts-null-undefined, ts-errors, ts-narrowing, ts-template-literals, ts-this-parameter]
---*/
// A Map reader returns the callee; node keeps the old function while arguments replace the entry and read updated state.
const log: string[] = [];
type Handler = (this: void, a: number, b: number) => number;
let state = 0, receiver: unknown = null;
function old(this: void, a: number, b: number): number { receiver = this; log.push(`old:${this === undefined}:${state}:${a}:${b}`); return state * 100 + a * 10 + b; }
function newer(this: void, a: number, b: number): number { log.push(`new:${a}:${b}`); return -100; }
function lookup(table: Map<string, Handler>): Handler { log.push("lookup"); const fn = table.get("call"); if (fn === undefined) throw new TypeError("missing"); return fn; }
function first(table: Map<string, Handler>, n: number): number { log.push(`first:${n}`); table.set("call", newer); state = n; return n + 1; }
function second(): number { log.push(`second:${state}`); return state + 2; }
function run(table: Map<string, Handler>, n: number): number { log.push("run"); return lookup(table)(first(table, n), second()); }
for (const n of [0, 4, -2]) {
  const table = new Map<string, Handler>([["call", old]]); state = 9; receiver = null; log.length = 0; const result = run(table, n);
  assert.compareArray(log, ["run", "lookup", `first:${n}`, `second:${n}`, `old:true:${n}:${n + 1}:${n + 2}`]);
  assert.sameValue(result, n * 100 + (n + 1) * 10 + n + 2); assert.sameValue(table.get("call"), newer); assert.sameValue(table.size, 1); assert.sameValue(receiver, undefined); assert.sameValue(state, n);
}

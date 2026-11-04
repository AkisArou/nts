/*---
description: "A later explicit argument is captured before an earlier parameter default mutates its source."
features: [ts-evaluation-order-routes, ts-evaluation-order-route-calls, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-class, ts-class-fields, ts-type-aliases, ts-function-types, ts-tuples, ts-closures, ts-unions, ts-null-undefined, ts-template-literals, ts-default-parameters]
---*/
// A class callback field carries two defaults; node reads both arguments before the first default writes shared state, preserving present arguments while absent ones read the new state.
const log: string[] = [];
type Callback = (a: number | undefined, b: number | undefined) => [number, number];
let state = 0;
function first(): undefined { log.push("arg1"); return undefined; }
function second(present: boolean): number | undefined { log.push(`arg2:${state}`); return present ? state : undefined; }
function initA(): number { log.push(`default:a:${state}`); state = 40; return 4; }
function initB(a: number): number { log.push(`default:b:${a}:${state}`); return a + state; }
function target(a = initA(), b = initB(a)): [number, number] { log.push(`body:${a}:${b}:${state}`); return [a, b]; }
class Holder { callback: Callback = target; }
function run(holder: Holder, present: boolean): [number, number] { log.push("run"); return holder.callback(first(), second(present)); }
for (const initial of [0, 3]) for (const present of [false, true]) {
  const holder = new Holder(); state = initial; log.length = 0; const result = run(holder, present), expected = ["run", "arg1", `arg2:${initial}`, `default:a:${initial}`], b = present ? initial : 44;
  if (!present) expected.push("default:b:4:40"); expected.push(`body:4:${b}:40`);
  assert.compareArray(log, expected);
  assert.compareArray(result, [4, b]); assert.sameValue(state, 40); assert.sameValue(holder.callback, target);
}

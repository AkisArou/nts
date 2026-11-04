/*---
description: "Control for calls-defaults-earlier-parameters; Parameter defaults run after all explicit arguments and read earlier initialized parameters in order."
features: [ts-evaluation-order-routes, ts-evaluation-order-route-calls, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-interfaces, ts-type-aliases, ts-function-types, ts-tuples, ts-readonly, ts-unions, ts-null-undefined, ts-objects, ts-template-literals]
---*/
// An interface callback field carries dependent defaults; node evaluates all arguments first, then only undefined defaults from left to right before the body. The control uses ordered temporaries.
const log: string[] = [];
type Result = [number, number, number];
type Callback = (a: number | undefined, b: number | undefined, c: number | undefined) => Result;
interface Holder { callback: Callback; }
function read(label: string, value: number | undefined): number | undefined { log.push(`arg:${label}:${value}`); return value; }
function initA(): number { log.push("default:a"); return 2; }
function initB(a: number): number { log.push(`default:b:${a}`); return a + 3; }
function initC(a: number, b: number): number { log.push(`default:c:${a}:${b}`); return a + b; }
function target(rawA: number | undefined, rawB: number | undefined, rawC: number | undefined): Result {
  let a = rawA; if (a === undefined) { const value = initA(); a = value; }
  let b = rawB; if (b === undefined) { const value = initB(a); b = value; }
  let c = rawC; if (c === undefined) { const value = initC(a, b); c = value; }
  log.push(`body:${a}:${b}:${c}`); return [a, b, c];
}
function run(holder: Holder, row: readonly (number | undefined)[]): Result {
  log.push("run");
  const receiver = holder;
  const fn = receiver.callback;
  const a = read("a", row[0]);
  const b = read("b", row[1]);
  const c = read("c", row[2]);
  return fn.call(receiver, a, b, c);
}
const rows: [number | undefined, number | undefined, number | undefined, number, number, number][] = [[undefined, undefined, undefined, 2, 5, 7], [3, undefined, undefined, 3, 6, 9], [0, 0, undefined, 0, 0, 0], [undefined, 7, 9, 2, 7, 9]];
for (const row of rows) {
  const holder: Holder = { callback: target }; log.length = 0; const result = run(holder, row), expected = ["run", `arg:a:${row[0]}`, `arg:b:${row[1]}`, `arg:c:${row[2]}`];
  if (row[0] === undefined) expected.push("default:a"); if (row[1] === undefined) expected.push(`default:b:${row[3]}`); if (row[2] === undefined) expected.push(`default:c:${row[3]}:${row[4]}`); expected.push(`body:${row[3]}:${row[4]}:${row[5]}`);
  assert.compareArray(log, expected);
  assert.compareArray(result, [row[3], row[4], row[5]]); assert.sameValue(holder.callback, target);
}

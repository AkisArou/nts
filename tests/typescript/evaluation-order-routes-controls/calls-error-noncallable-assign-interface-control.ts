/*---
description: "Control for calls-error-noncallable-assign-interface; A noncallable method captured through Object.assign throws only after both arguments repair its field."
features: [ts-evaluation-order-routes, ts-evaluation-order-route-calls, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-interfaces, ts-type-aliases, ts-function-types, ts-this, ts-accessors, ts-objects, ts-tuples, ts-unions, ts-null-undefined, ts-unknown, ts-errors, ts-instanceof, ts-narrowing, ts-unsound-object-assign, ts-template-literals, ts-this-parameter]
---*/
// An ordinarily widened interface field holds a noncallable value; node gets it before arguments, runs both repairs and then throws TypeError instead of calling the replacement. The control uses ordered temporaries.
const log: string[] = [];
type Handler = (this: Host, a: number, b: number) => number;
interface Host { current: Handler; state: number; readonly method: Handler; }
function good(this: Host, a: number, b: number): number { log.push(`good:${this.state}:${a}:${b}`); return this.state * 100 + a * 10 + b; }
function first(host: Host, n: number): number { log.push(`first:${n}`); host.current = good; host.state = n; return n + 1; }
function second(host: Host): number { log.push(`second:${host.state}`); return host.state + 2; }
function run(host: Host, n: number): number {
  log.push("run");
  const receiver = host;
  const fn = receiver.method;
  const a = first(host, n);
  const b = second(host);
  return fn.call(receiver, a, b);
}
const rows: [unknown, boolean][] = [[0, false], ["text", false], [false, false], [null, false], [undefined, false], [{}, false], [good, true]];
for (const row of rows) for (const n of [0, 3]) {
  const host: Host = { current: good, state: 9, get method(): Handler { log.push("get"); return this.current; } }; Object.assign(host, { current: row[0] }); log.length = 0; let result: number | undefined, caught: unknown;
  try { result = run(host, n); } catch (error: unknown) { caught = error; log.push("catch"); }
  assert.compareArray(log, ["run", "get", `first:${n}`, `second:${n}`, row[1] ? `good:${n}:${n + 1}:${n + 2}` : "catch"]);
  assert.sameValue(host.current, good); assert.sameValue(host.state, n);
  if (row[1]) { assert.sameValue(caught, undefined); assert.sameValue(result, n * 100 + (n + 1) * 10 + n + 2); }
  else { assert.sameValue(result, undefined); assert.sameValue(caught instanceof TypeError, true); if (caught instanceof TypeError) assert.sameValue(caught.constructor, TypeError); }
}

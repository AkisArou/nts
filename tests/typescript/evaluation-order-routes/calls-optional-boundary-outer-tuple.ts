/*---
description: "An optional inner method skips only its own chain while the outer call retains its selected callee and evaluates the next argument."
features: [ts-evaluation-order-routes, ts-evaluation-order-route-calls, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-interfaces, ts-tuples, ts-type-aliases, ts-function-types, ts-this, ts-objects, ts-accessors, ts-unions, ts-null-undefined, ts-errors, ts-narrowing, ts-template-literals, ts-optional-chaining, ts-this-parameter]
---*/
// A tuple carries an outer callee and nullable method receiver; node captures both live callees before mutation, always evaluates the outer tail and preserves the inner result.
const log: string[] = [];
type Method = (this: Host, value: number) => number;
interface Host { value: number; current: Method; readonly method: Method; }
type Combine = (this: Input, a: number | undefined, b: number) => (number | undefined)[];
type Input = [Combine, Host | null | undefined, number];
function old(this: Host, value: number): number { log.push(`old:${this.value}:${value}`); return this.value * 10 + value; }
function newer(this: Host, value: number): number { log.push("new"); return -100; }
function combine(this: Input, a: number | undefined, b: number): (number | undefined)[] { log.push(`combine:${this[2]}`); return [a, b]; }
function wrong(this: Input, a: number | undefined, b: number): (number | undefined)[] { log.push("wrong"); return []; }
function source(input: Input): Host | null | undefined { log.push("source"); return input[1]; }
function first(input: Input): number { log.push(`first:${input[2]}`); const host = input[1]; if (host === null || host === undefined) throw new Error("missing host"); input[0] = wrong; host.current = newer; host.value = 7; return ++input[2]; }
function after(input: Input): number { log.push(`after:${input[2]}`); const value = input[2]; input[2] += 10; return value; }
function run(input: Input): (number | undefined)[] { log.push("run"); return input[0](source(input)?.method(first(input)), after(input)); }
for (const mode of ["null", "undefined", "live"]) for (const n of [0, 3]) {
  const host: Host = { value: 1, current: old, get method(): Method { log.push("get"); return this.current; } }, input: Input = [combine, mode === "null" ? null : mode === "undefined" ? undefined : host, n]; log.length = 0; const result = run(input), tail = n + (mode === "live" ? 1 : 0);
  const expected = ["run", "source"]; if (mode === "live") expected.push("get", `first:${n}`, `old:7:${n + 1}`); expected.push(`after:${tail}`, `combine:${tail + 10}`);
  assert.compareArray(log, expected);
  assert.compareArray(result, [mode === "live" ? 71 + n : undefined, tail]); assert.sameValue(input[0], mode === "live" ? wrong : combine); assert.sameValue(input[2], tail + 10); assert.sameValue(host.current, mode === "live" ? newer : old); assert.sameValue(host.value, mode === "live" ? 7 : 1);
}

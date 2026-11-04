/*---
description: "An optional method call skips all arguments only for nullish callees and otherwise captures the old callee."
features: [ts-evaluation-order-routes, ts-evaluation-order-route-calls, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-interfaces, ts-type-aliases, ts-function-types, ts-this, ts-rest-parameters, ts-spread, ts-symbols, ts-objects, ts-accessors, ts-tuples, ts-unions, ts-null-undefined, ts-unknown, ts-errors, ts-instanceof, ts-narrowing, ts-literal-types, ts-unsound-object-assign, ts-template-literals, ts-optional-chaining, ts-this-parameter]
---*/
// An interface optional method carries nullish, invalid and callable values; node skips its entire argument list only for nullish values and otherwise exhausts the spread before calling or throwing.
const log: string[] = [];
type Method = (this: Host, ...values: number[]) => number[];
type Mode = "skip" | "error" | "live";
interface Host { value: number; current: Method | null | undefined; readonly method: Method | null | undefined; }
function old(this: Host, ...values: number[]): number[] { log.push(`old:${this.value}`); return values; }
function newer(this: Host, ...values: number[]): number[] { log.push("new"); return []; }
function first(host: Host, n: number): number { log.push(`first:${n}`); host.current = newer; host.value = n; return n + 1; }
function middle(host: Host): Iterable<number, undefined, unknown> { log.push("spread"); return { [Symbol.iterator](): Iterator<number, undefined, unknown> { log.push("iterator"); let index = 0; return { next(): IteratorResult<number, undefined> { log.push(`next:${index}`); if (index++ === 0) return { done: false, value: host.value + 2 }; host.value += 10; return { done: true, value: undefined }; } }; } }; }
function tail(host: Host): number { log.push(`tail:${host.value}`); return host.value; }
function run(host: Host, n: number): number[] | undefined { log.push("run"); return host.method?.(first(host, n), ...middle(host), tail(host)); }
const rows: [unknown, Mode][] = [[null, "skip"], [undefined, "skip"], [0, "error"], [false, "error"], ["", "error"], [old, "live"]];
for (const row of rows) for (const n of [0, 3]) {
  const host: Host = { value: 9, current: old, get method(): Method | null | undefined { log.push("get"); return this.current; } }; Object.assign(host, { current: row[0] }); log.length = 0; let result: number[] | undefined, caught: unknown;
  try { result = run(host, n); } catch (error: unknown) { caught = error; log.push("catch"); }
  const expected = ["run", "get"]; if (row[1] !== "skip") expected.push(`first:${n}`, "spread", "iterator", "next:0", "next:1", `tail:${n + 10}`, row[1] === "live" ? `old:${n + 10}` : "catch");
  assert.compareArray(log, expected);
  assert.sameValue(host.value, row[1] === "skip" ? 9 : n + 10); assert.sameValue(Object.is(host.current, row[1] === "skip" ? row[0] : newer), true);
  if (row[1] === "live") { assert.sameValue(caught, undefined); if (result === undefined) throw new Error("missing result"); assert.compareArray(result, [n + 1, n + 2, n + 10]); }
  else { assert.sameValue(result, undefined); assert.sameValue(caught instanceof TypeError, row[1] === "error"); if (caught instanceof TypeError) assert.sameValue(caught.constructor, TypeError); else assert.sameValue(caught, undefined); }
}

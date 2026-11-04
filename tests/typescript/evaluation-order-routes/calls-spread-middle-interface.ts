/*---
description: "A spread argument exhausts its iterator before the following argument and keeps the previously read method."
features: [ts-evaluation-order-routes, ts-evaluation-order-route-calls, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-interfaces, ts-type-aliases, ts-function-types, ts-this, ts-rest-parameters, ts-spread, ts-symbols, ts-objects, ts-accessors, ts-null-undefined, ts-template-literals, ts-this-parameter]
---*/
// An interface method receives head, spread and tail arguments; node gets the old method first and completes every iterator step before evaluating the tail.
const log: string[] = [];
type Method = (this: Host, ...values: number[]) => number[];
interface Host { value: number; current: Method; readonly method: Method; }
function old(this: Host, ...values: number[]): number[] { log.push(`old:${this.value}`); return values; }
function newer(this: Host, ...values: number[]): number[] { log.push("new"); return []; }
function head(host: Host, n: number): number { log.push(`head:${n}`); host.current = newer; return n + 1; }
function middle(host: Host, n: number, count: number): Iterable<number, undefined, unknown> {
  log.push("spread"); return { [Symbol.iterator](): Iterator<number, undefined, unknown> { log.push("iterator"); let index = 0; return { next(): IteratorResult<number, undefined> { log.push(`next:${index}`); host.value = n + index + 10; if (index === count) return { done: true, value: undefined }; return { done: false, value: n + index++ + 2 }; } }; } };
}
function tail(host: Host): number { log.push(`tail:${host.value}`); return host.value; }
function run(host: Host, n: number, count: number): number[] { log.push("run"); return host.method(head(host, n), ...middle(host, n, count), tail(host)); }
for (const n of [0, 3]) for (const count of [0, 1, 2]) {
  const host: Host = { value: -1, current: old, get method(): Method { log.push("get"); return this.current; } }; log.length = 0; const result = run(host, n, count);
  const expected = ["run", "get", `head:${n}`, "spread", "iterator"], values = [n + 1]; for (let i = 0; i <= count; i++) expected.push(`next:${i}`); for (let i = 0; i < count; i++) values.push(n + i + 2); values.push(n + count + 10); expected.push(`tail:${n + count + 10}`, `old:${n + count + 10}`);
  assert.compareArray(log, expected);
  assert.compareArray(result, values); assert.sameValue(host.value, n + count + 10); assert.sameValue(host.current, newer);
}

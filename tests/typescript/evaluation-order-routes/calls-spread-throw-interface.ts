/*---
description: "An abrupt spread iterator stops later arguments and the method body after preserving earlier effects."
features: [ts-evaluation-order-routes, ts-evaluation-order-route-calls, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-interfaces, ts-function-types, ts-rest-parameters, ts-spread, ts-symbols, ts-objects, ts-accessors, ts-null-undefined, ts-unknown, ts-unions, ts-errors, ts-narrowing, ts-instanceof, ts-template-literals]
---*/
// An interface carries the callee and its middle iterable; node evaluates head and each reached next step, then propagates the iterator error without tail, body or return cleanup.
const log: string[] = [];
interface Host { readonly method: (...values: number[]) => number[]; }
function body(...values: number[]): number[] { log.push("body"); return values; }
function head(): number { log.push("head"); return 1; }
function tail(): number { log.push("tail"); return 4; }
function middle(failAt: number): Iterable<number, undefined, unknown> {
  log.push("spread"); return { [Symbol.iterator](): Iterator<number, undefined, unknown> { log.push("iterator"); let index = 0; return {
    next(): IteratorResult<number, undefined> { log.push(`next:${index}`); if (index === failAt) throw new RangeError(`next:${index}`); if (index === 2) return { done: true, value: undefined }; return { done: false, value: index++ + 2 }; },
    return(): IteratorResult<number, undefined> { log.push("return"); return { done: true, value: undefined }; }
  }; } };
}
function run(host: Host, failAt: number): number[] { log.push("run"); return host.method(head(), ...middle(failAt), tail()); }
for (const failAt of [-1, 0, 1, 2]) {
  const host: Host = { get method(): (...values: number[]) => number[] { log.push("get"); return body; } }; log.length = 0; let result: number[] | undefined, caught: unknown;
  try { result = run(host, failAt); } catch (error: unknown) { caught = error; log.push("catch"); }
  const expected = ["run", "get", "head", "spread", "iterator"]; for (let i = 0; i <= (failAt < 0 ? 2 : failAt); i++) expected.push(`next:${i}`); if (failAt < 0) expected.push("tail", "body"); else expected.push("catch");
  assert.compareArray(log, expected);
  if (failAt < 0) { assert.sameValue(caught, undefined); if (result === undefined) throw new Error("missing result"); assert.compareArray(result, [1, 2, 3, 4]); }
  else { assert.sameValue(result, undefined); assert.sameValue(caught instanceof RangeError, true); if (caught instanceof RangeError) { assert.sameValue(caught.constructor, RangeError); assert.sameValue(caught.message, `next:${failAt}`); } }
}

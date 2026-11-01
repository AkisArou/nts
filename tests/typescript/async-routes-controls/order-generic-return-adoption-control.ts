/*---
description: Control for order-generic-return-adoption; concrete calls or explicit iteration state retain every await and microtask.
features: [ts-async-route-ordering, ts-async, ts-functions, ts-function-types, ts-unions, ts-errors, ts-unknown, ts-arrays, ts-generics]
flags: [async]
---*/
// Control: use concrete calls or explicit iteration state, preserving all reaction jobs and observations.
type OrderValue = number | string | undefined | { id: number };
const log: unknown[] = [];
function same(actual: unknown, wanted: unknown): void { assert.sameValue(Object.is(actual, wanted), true); assert.sameValue(typeof actual, typeof wanted); assert.sameValue(actual instanceof Error, wanted instanceof Error); if (actual instanceof Error && wanted instanceof Error) assert.sameValue(actual.message, wanted.message); }
async function immediate(value: OrderValue, fail: boolean, reason: unknown): Promise<OrderValue> {
  log.push("direct-entered", value);
  try { if (fail) { log.push("direct-throw", reason); throw reason; } log.push("direct-settled", value); return value; }
  finally { log.push("direct-finally", value); }
}
async function adopted(value: OrderValue, fail: boolean, reason: unknown): Promise<OrderValue> {
  log.push("adopt-entered", value);
  try { const source = fail ? Promise.reject<OrderValue>(reason) : Promise.resolve(value); log.push("adopt-returned", fail ? reason : value); return source; }
  finally { log.push("adopt-finally", value); }
}
async function awaited(value: OrderValue, fail: boolean, reason: unknown): Promise<OrderValue> {
  log.push("await-entered", value);
  try { const result = await (fail ? Promise.reject<OrderValue>(reason) : Promise.resolve(value)); log.push("await-resumed", result, "await-settled", result); return result; }
  catch (error: unknown) { log.push("await-caught", error); throw error; }
  finally { log.push("await-finally", value); }
}
function observe(label: string, pending: Promise<OrderValue>): Promise<unknown> { return pending.then((item) => { log.push("reaction", label, item); return item; }, (error: unknown) => { log.push("reaction-caught", label, error); return error; }); }
async function main(): Promise<void> {
  const identity = { id: 1 };
  const inputs: [OrderValue, unknown][] = [[7, new RangeError("order")], [-0, "reason"], ["中", undefined], [undefined, -0], [identity, { id: 2 }]];
  for (const [value, reason] of inputs) for (const fail of [false, true]) {
    log.length = 0;
    const direct = immediate(value, fail, reason), adoption = adopted(value, fail, reason), waiting = awaited(value, fail, reason);
    const first = observe("direct", direct), second = observe("adopt", adoption), third = observe("await", waiting);
    queueMicrotask(() => log.push("microtask", value)); log.push("started", value);
    const results = await Promise.all([first, second, third]); log.push("joined", ...results); const answer = fail ? reason : value; for (const result of results) same(result, answer);
    const expected: unknown[] = ["direct-entered", value, fail ? "direct-throw" : "direct-settled", answer, "direct-finally", value, "adopt-entered", value, "adopt-returned", answer, "adopt-finally", value, "await-entered", value, "started", value];
    if (fail) expected.push("await-caught", reason); else expected.push("await-resumed", value, "await-settled", value);
    const reaction = fail ? "reaction-caught" : "reaction"; expected.push("await-finally", value, reaction, "direct", answer, "microtask", value, reaction, "await", answer, reaction, "adopt", answer, "joined", answer, answer, answer); assert.compareArray(log, expected);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));

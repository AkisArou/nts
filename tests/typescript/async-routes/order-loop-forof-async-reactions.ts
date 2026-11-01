/*---
description: Async reaction closures retain reassigned for-of bindings through two suspensions, write independently, and preserve their fulfillment or rejection order.
features: [ts-async-route-ordering, ts-async, ts-functions, ts-function-types, ts-unions, ts-errors, ts-unknown, ts-arrays, ts-closures, ts-arrow-functions, ts-iteration]
flags: [async]
---*/
// Route: typed then callbacks capture separate for-of bindings; node sees the pre-call replacement and each post-await write before final settlement.
type OrderValue = number | string | undefined | { id: number };
const log: unknown[] = [];
function same(actual: unknown, wanted: unknown): void { assert.sameValue(Object.is(actual, wanted), true); assert.sameValue(typeof actual, typeof wanted); assert.sameValue(actual instanceof Error, wanted instanceof Error); if (actual instanceof Error && wanted instanceof Error) assert.sameValue(actual.message, wanted.message); }
type OrderReaction = (incoming: OrderValue) => Promise<OrderValue>;
async function main(): Promise<void> {
  const identity = { id: 1 };
  const inputs: [OrderValue, unknown][] = [[7, new RangeError("order")], [-0, "reason"], ["中", undefined], [undefined, -0], [identity, { id: 2 }]];
  for (const [value, reason] of inputs) for (const queued of [false, true]) for (const fail of [false, true]) {
    log.length = 0; const initial: OrderValue[] = [value, undefined, { id: 3 }], prepared: OrderValue[] = [initial[1], initial[2], initial[0]], replacement: OrderValue[] = [initial[2], initial[0], initial[1]];
    const callbacks: OrderReaction[] = [], readers: (() => OrderValue)[] = [];
    for (let current of initial) {
      const id = callbacks.length;
      callbacks.push(async (incoming) => {
        log.push("entered", id, current, incoming);
        const seen = await Promise.resolve(incoming).then((item) => { log.push("then", id, item); return item; }); log.push("resumed", id, current, seen); same(seen, incoming);
        current = replacement[id]; log.push("write", id, current);
        try { await Promise.resolve(); if (fail) { log.push("throw", id, reason); throw reason; } log.push("settled", id, current); return current; }
        finally { log.push("finally", id, current); }
      });
      current = prepared[id]; log.push("prepared", id, current); readers.push(() => { log.push("read", id, current); return current; });
    }
    const source = new Promise<OrderValue>((resolve) => { const settle = (): void => { log.push("resolve", value); resolve(value); }; if (queued) queueMicrotask(settle); else settle(); });
    const pending = callbacks.map((callback, id) => source.then(callback).then((item) => { log.push("received", id, item); same(item, replacement[id]); return item; }, (error: unknown) => { log.push("caught", id, error); same(error, reason); return error; }));
    queueMicrotask(() => log.push("microtask", value)); log.push("started");
    const results = await Promise.all(pending); log.push("joined", ...results); for (let id = 0; id < initial.length; id++) { same(results[id], fail ? reason : replacement[id]); same(readers[id](), replacement[id]); }
    const expected: unknown[] = []; for (let id = 0; id < initial.length; id++) expected.push("prepared", id, prepared[id]); if (!queued) expected.push("resolve", value); expected.push("started");
    if (queued) expected.push("resolve", value, "microtask", value); for (let id = 0; id < initial.length; id++) expected.push("entered", id, prepared[id], value); if (!queued) expected.push("microtask", value);
    for (let id = 0; id < initial.length; id++) expected.push("then", id, value); for (let id = 0; id < initial.length; id++) expected.push("resumed", id, prepared[id], value, "write", id, replacement[id]);
    for (let id = 0; id < initial.length; id++) expected.push(fail ? "throw" : "settled", id, fail ? reason : replacement[id], "finally", id, replacement[id]);
    for (let id = 0; id < initial.length; id++) expected.push(fail ? "caught" : "received", id, fail ? reason : replacement[id]); expected.push("joined", ...(fail ? [reason, reason, reason] : replacement));
    for (let id = 0; id < initial.length; id++) expected.push("read", id, replacement[id]); assert.compareArray(log, expected);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));

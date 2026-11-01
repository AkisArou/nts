/*---
description: Control for order-stored-async-reactions; concrete calls or explicit iteration state retain every await and microtask.
features: [ts-async-route-ordering, ts-async, ts-functions, ts-function-types, ts-unions, ts-errors, ts-unknown, ts-arrays, ts-objects, ts-closures]
flags: [async]
---*/
// Control: use concrete calls or explicit iteration state, preserving all reaction jobs and observations.
type OrderValue = number | string | undefined | { id: number };
const log: unknown[] = [];
function same(actual: unknown, wanted: unknown): void { assert.sameValue(Object.is(actual, wanted), true); assert.sameValue(typeof actual, typeof wanted); assert.sameValue(actual instanceof Error, wanted instanceof Error); if (actual instanceof Error && wanted instanceof Error) assert.sameValue(actual.message, wanted.message); }
async function follow(label: string, pending: Promise<OrderValue>): Promise<unknown> {
  log.push("observer-entered", label);
  try { const result = await pending; log.push("received", label, result); return result; }
  catch (error: unknown) { log.push("caught", label, error); return error; }
  finally { log.push("observer-finally", label); }
}
async function main(): Promise<void> {
  const identity = { id: 1 };
  const inputs: [OrderValue, unknown][] = [[7, new RangeError("order")], [-0, "reason"], ["中", undefined], [undefined, -0], [identity, { id: 2 }]];
  for (const [value, reason] of inputs) for (const queued of [false, true]) for (const fail of [false, true]) {
    log.length = 0;
    async function left(item: OrderValue): Promise<OrderValue> {
      log.push("left-entered", item);
      try { const resumed = await Promise.resolve(item); log.push("left-resumed", resumed); queueMicrotask(() => log.push("left-microtask", resumed)); if (fail) { log.push("left-throw", reason); throw reason; } log.push("left-settled", resumed); return resumed; }
      finally { log.push("left-finally", item); }
    }
    async function right(item: OrderValue): Promise<OrderValue> {
      log.push("right-entered", item);
      try { const resumed = await Promise.resolve(item).then((received) => { log.push("right-then", received); return received; }); log.push("right-resumed", resumed, "right-settled", resumed); return resumed; }
      finally { log.push("right-finally", item); }
    }
    const source = new Promise<OrderValue>((resolve) => { const settle = (): void => { log.push("resolve", value); resolve(value); }; if (queued) queueMicrotask(settle); else settle(); });
    const first = follow("a", source.then(left)), second = follow("b", source.then(right));
    queueMicrotask(() => log.push("microtask", value)); log.push("started", value);
    const results = await Promise.all([first, second]); log.push("joined", ...results); same(results[0], fail ? reason : value); same(results[1], value);
    const expected: unknown[] = queued ? [] : ["resolve", value]; expected.push("observer-entered", "a", "observer-entered", "b", "started", value);
    if (queued) expected.push("resolve", value, "microtask", value); expected.push("left-entered", value, "right-entered", value); if (!queued) expected.push("microtask", value);
    expected.push("left-resumed", value, fail ? "left-throw" : "left-settled", fail ? reason : value, "left-finally", value, "right-then", value, "left-microtask", value, "right-resumed", value, "right-settled", value, "right-finally", value);
    expected.push(fail ? "caught" : "received", "a", fail ? reason : value, "observer-finally", "a", "received", "b", value, "observer-finally", "b", "joined", fail ? reason : value, value); assert.compareArray(log, expected);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));

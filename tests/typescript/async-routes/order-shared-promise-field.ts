/*---
description: Three async awaiters of an interface promise field preserve reaction registration order for settled and pending fulfillment or rejection.
features: [ts-async-route-ordering, ts-async, ts-functions, ts-function-types, ts-unions, ts-errors, ts-unknown, ts-arrays, ts-interfaces]
flags: [async]
---*/
// Route: AwaitSlot.promise is shared by three async calls; a then reaction and microtask expose the exact resume order.
type OrderValue = number | string | undefined | { id: number };
const log: unknown[] = [];
function same(actual: unknown, wanted: unknown): void { assert.sameValue(Object.is(actual, wanted), true); assert.sameValue(typeof actual, typeof wanted); assert.sameValue(actual instanceof Error, wanted instanceof Error); if (actual instanceof Error && wanted instanceof Error) assert.sameValue(actual.message, wanted.message); }
interface AwaitSlot { promise: Promise<OrderValue>; }
async function watch(label: string, slot: AwaitSlot): Promise<unknown> {
  log.push("entered", label, slot.promise);
  try { const result = await Promise.resolve(slot.promise); log.push("resumed", label, result, "settled", label, result); return result; }
  catch (error: unknown) { log.push("caught", label, error, "settled", label, error); return error; }
  finally { log.push("finally", label); }
}
async function main(): Promise<void> {
  const identity = { id: 1 };
  const inputs: [OrderValue, unknown][] = [[7, new RangeError("order")], [-0, "reason"], ["中", undefined], [undefined, -0], [identity, { id: 2 }]];
  for (const [value, reason] of inputs) for (const queued of [false, true]) for (const fail of [false, true]) {
    log.length = 0;
    const source = new Promise<OrderValue>((resolve, reject) => {
      const settle = (): void => { log.push(fail ? "reject" : "resolve", fail ? reason : value); if (fail) reject(reason); else resolve(value); };
      if (queued) queueMicrotask(settle); else settle();
    });
    const slot: AwaitSlot = { promise: source }; const first = watch("a", slot);
    const reaction = source.then((item) => { log.push("then", item); return item; }, (error: unknown) => { log.push("then-catch", error); return error; });
    queueMicrotask(() => log.push("microtask", value)); const second = watch("b", slot), third = watch("c", slot); log.push("started", value);
    const results = await Promise.all([first, reaction, second, third]); log.push("received", ...results);
    const answer = fail ? reason : value; same(results.length, 4); for (const result of results) same(result, answer);
    const settlement: unknown[] = [fail ? "reject" : "resolve", answer], expected: unknown[] = queued ? [] : [...settlement];
    expected.push("entered", "a", source, "entered", "b", source, "entered", "c", source, "started", value);
    if (queued) expected.push(...settlement, "microtask", value);
    const steps = (label: string): unknown[] => [fail ? "caught" : "resumed", label, answer, "settled", label, answer, "finally", label];
    expected.push(...steps("a"), fail ? "then-catch" : "then", answer); if (!queued) expected.push("microtask", value);
    expected.push(...steps("b"), ...steps("c"), "received", answer, answer, answer, answer); assert.compareArray(log, expected);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));

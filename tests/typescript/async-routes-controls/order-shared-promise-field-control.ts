/*---
description: Control for order-shared-promise-field; concrete calls or explicit iteration state retain every await and microtask.
features: [ts-async-route-ordering, ts-async, ts-functions, ts-function-types, ts-unions, ts-errors, ts-unknown, ts-arrays, ts-interfaces]
flags: [async]
---*/
// Control: use concrete calls or explicit iteration state, preserving all reaction jobs and observations.
type OrderValue = number | string | undefined | { id: number };
const log: unknown[] = [];
function same(actual: unknown, wanted: unknown): void { assert.sameValue(Object.is(actual, wanted), true); assert.sameValue(typeof actual, typeof wanted); assert.sameValue(actual instanceof Error, wanted instanceof Error); if (actual instanceof Error && wanted instanceof Error) assert.sameValue(actual.message, wanted.message); }
async function watch(label: string, source: Promise<OrderValue>): Promise<unknown> {
  log.push("entered", label, source);
  try { const result = await Promise.resolve(source); log.push("resumed", label, result, "settled", label, result); return result; }
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
    const first = watch("a", source);
    const reaction = source.then((item) => { log.push("then", item); return item; }, (error: unknown) => { log.push("then-catch", error); return error; });
    queueMicrotask(() => log.push("microtask", value)); const second = watch("b", source), third = watch("c", source); log.push("started", value);
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

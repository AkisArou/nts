/*---
description: Async closures created in a for-let loop keep separate live bindings while a microtask write races settled or pending awaits.
features: [ts-async-route-ordering, ts-async, ts-functions, ts-function-types, ts-unions, ts-errors, ts-unknown, ts-arrays, ts-closures, ts-arrow-functions, ts-iteration]
flags: [async]
---*/
// Route: typed async jobs capture each for-let index and mutable value; node reads before or after the queued writer according to gate settlement.
type OrderValue = number | string | undefined | { id: number };
const log: unknown[] = [];
function same(actual: unknown, wanted: unknown): void { assert.sameValue(Object.is(actual, wanted), true); assert.sameValue(typeof actual, typeof wanted); assert.sameValue(actual instanceof Error, wanted instanceof Error); if (actual instanceof Error && wanted instanceof Error) assert.sameValue(actual.message, wanted.message); }
type OrderJob = (gate: Promise<void>) => Promise<OrderValue>;
async function main(): Promise<void> {
  const identity = { id: 1 };
  const inputs: [OrderValue, unknown][] = [[7, new RangeError("order")], [-0, "reason"], ["中", undefined], [undefined, -0], [identity, { id: 2 }]];
  for (const [value, reason] of inputs) for (const queued of [false, true]) for (const fail of [false, true]) {
    log.length = 0; const initial: OrderValue[] = [value, undefined, { id: 3 }], next: OrderValue[] = [initial[1], initial[2], initial[0]];
    const jobs: OrderJob[] = [], writers: ((value: OrderValue) => void)[] = [], readers: (() => OrderValue)[] = [];
    for (let index = 0; index < initial.length; index++) {
      let current: OrderValue = initial[index];
      jobs.push(async (gate) => {
        log.push("entered", index, current);
        try { await gate; log.push("resumed", index, current); }
        catch (error: unknown) { log.push("caught", index, error, current); same(error, reason); }
        finally { log.push("finally", index, current); }
        await Promise.resolve(); log.push("settled", index, current); return current;
      });
      writers.push((replacement) => { current = replacement; log.push("write", index, current); }); readers.push(() => { log.push("read", index, current); return current; });
    }
    const gate = new Promise<void>((resolve, reject) => { const settle = (): void => { log.push(fail ? "reject" : "resolve", fail ? reason : undefined); if (fail) reject(reason); else resolve(); }; if (queued) queueMicrotask(settle); else settle(); });
    const pending = Promise.all(jobs.map((job) => job(gate)));
    queueMicrotask(() => { for (let index = 0; index < initial.length; index++) writers[index](next[index]); }); log.push("started");
    const results = await pending; log.push("joined", ...results); for (let index = 0; index < initial.length; index++) { same(results[index], next[index]); same(readers[index](), next[index]); }
    const settlement: unknown[] = [fail ? "reject" : "resolve", fail ? reason : undefined], expected: unknown[] = queued ? [] : [...settlement];
    for (let index = 0; index < initial.length; index++) expected.push("entered", index, initial[index]); expected.push("started"); if (queued) expected.push(...settlement);
    const writes: unknown[] = []; for (let index = 0; index < initial.length; index++) writes.push("write", index, next[index]); if (queued) expected.push(...writes);
    for (let index = 0; index < initial.length; index++) { const read = queued ? next[index] : initial[index]; if (fail) expected.push("caught", index, reason, read); else expected.push("resumed", index, read); expected.push("finally", index, read); }
    if (!queued) expected.push(...writes); for (let index = 0; index < initial.length; index++) expected.push("settled", index, next[index]); expected.push("joined", ...next);
    for (let index = 0; index < initial.length; index++) expected.push("read", index, next[index]); assert.compareArray(log, expected);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));

/*---
description: Control for order-loop-let-resume-writes; concrete calls or explicit iteration state retain every await and microtask.
features: [ts-async-route-ordering, ts-async, ts-functions, ts-function-types, ts-unions, ts-errors, ts-unknown, ts-arrays, ts-closures, ts-arrow-functions, ts-iteration]
flags: [async]
---*/
// Control: use concrete calls or explicit iteration state, preserving all reaction jobs and observations.
type OrderValue = number | string | undefined | { id: number };
const log: unknown[] = [];
function same(actual: unknown, wanted: unknown): void { assert.sameValue(Object.is(actual, wanted), true); assert.sameValue(typeof actual, typeof wanted); assert.sameValue(actual instanceof Error, wanted instanceof Error); if (actual instanceof Error && wanted instanceof Error) assert.sameValue(actual.message, wanted.message); }
interface OrderState { id: number; value: OrderValue; }
async function run(state: OrderState, gate: Promise<void>, reason: unknown): Promise<OrderValue> {
  log.push("entered", state.id, state.value);
  try { await gate; log.push("resumed", state.id, state.value); }
  catch (error: unknown) { log.push("caught", state.id, error, state.value); same(error, reason); }
  finally { log.push("finally", state.id, state.value); }
  await Promise.resolve(); log.push("settled", state.id, state.value); return state.value;
}
async function main(): Promise<void> {
  const identity = { id: 1 };
  const inputs: [OrderValue, unknown][] = [[7, new RangeError("order")], [-0, "reason"], ["中", undefined], [undefined, -0], [identity, { id: 2 }]];
  for (const [value, reason] of inputs) for (const queued of [false, true]) for (const fail of [false, true]) {
    log.length = 0; const initial: OrderValue[] = [value, undefined, { id: 3 }], next: OrderValue[] = [initial[1], initial[2], initial[0]];
    const states: OrderState[] = []; for (let index = 0; index < initial.length; index++) states.push({ id: index, value: initial[index] });
    const gate = new Promise<void>((resolve, reject) => { const settle = (): void => { log.push(fail ? "reject" : "resolve", fail ? reason : undefined); if (fail) reject(reason); else resolve(); }; if (queued) queueMicrotask(settle); else settle(); });
    const pending = Promise.all(states.map((state) => run(state, gate, reason)));
    queueMicrotask(() => { for (let index = 0; index < initial.length; index++) { states[index].value = next[index]; log.push("write", index, states[index].value); } }); log.push("started");
    const results = await pending; log.push("joined", ...results); for (let index = 0; index < initial.length; index++) { same(results[index], next[index]); log.push("read", index, states[index].value); same(states[index].value, next[index]); }
    const settlement: unknown[] = [fail ? "reject" : "resolve", fail ? reason : undefined], expected: unknown[] = queued ? [] : [...settlement];
    for (let index = 0; index < initial.length; index++) expected.push("entered", index, initial[index]); expected.push("started"); if (queued) expected.push(...settlement);
    const writes: unknown[] = []; for (let index = 0; index < initial.length; index++) writes.push("write", index, next[index]); if (queued) expected.push(...writes);
    for (let index = 0; index < initial.length; index++) { const read = queued ? next[index] : initial[index]; if (fail) expected.push("caught", index, reason, read); else expected.push("resumed", index, read); expected.push("finally", index, read); }
    if (!queued) expected.push(...writes); for (let index = 0; index < initial.length; index++) expected.push("settled", index, next[index]); expected.push("joined", ...next);
    for (let index = 0; index < initial.length; index++) expected.push("read", index, next[index]); assert.compareArray(log, expected);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));

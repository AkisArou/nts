/*---
description: Control for value-await-union-generic; concrete values keep the same awaits and settlement history.
features: [ts-async-route-values-thenables, ts-async, ts-generics, ts-unions, ts-functions, ts-function-types, ts-errors, ts-unknown]
flags: [async]
---*/
// Control: remove the generic or interface view; retain adoption jobs and callback order.
type AwaitValue = number | string | undefined | { id: number };
const log: unknown[] = [];
function same(actual: unknown, wanted: unknown): void { assert.sameValue(Object.is(actual, wanted), true); assert.sameValue(typeof actual, typeof wanted); assert.sameValue(actual instanceof Error, wanted instanceof Error); if (actual instanceof Error && wanted instanceof Error) assert.sameValue(actual.message, wanted.message); }
async function unwrapValue(input: AwaitValue): Promise<AwaitValue> {
  log.push("entered", input);
  try { const result = await input; log.push("resumed", result); return result; }
  catch (error: unknown) { log.push("rejected", error); throw error; }
  finally { log.push("finally", input); }
}
async function unwrapPromise(input: Promise<AwaitValue>): Promise<AwaitValue> {
  log.push("entered", input);
  try { const result = await input; log.push("resumed", result); return result; }
  catch (error: unknown) { log.push("rejected", error); throw error; }
  finally { log.push("finally", input); }
}
async function main(): Promise<void> {
  const object = { id: 1 }, other = { id: 2 };
  const inputs: [AwaitValue, AwaitValue, unknown][] = [[7, -0, new RangeError("route")], [-0, "late", "reason"], ["中", undefined, -0], [undefined, other, undefined], [object, 7, { id: 3 }]];
  for (const [value, alternate, reason] of inputs) for (const mode of ["value", "settled", "pending"]) for (const fail of [false, true]) {
    if (mode === "value" && fail) continue;
    log.length = 0;
    const input: AwaitValue | Promise<AwaitValue> = mode === "value" ? value : new Promise<AwaitValue>((resolve, reject) => {
      const settle = (): void => { log.push(fail ? "reject" : "resolve", fail ? reason : value); if (fail) reject(reason); else resolve(value); };
      if (mode === "pending") queueMicrotask(settle); else settle();
    });
    log.push("call", input); const pending = input instanceof Promise ? unwrapPromise(input) : unwrapValue(input); log.push("pending", input); let caught = false;
    try { const result = await pending; log.push("received", result); same(result, value); }
    catch (error: unknown) { caught = true; log.push("caught", error); same(error, reason); }
    finally { log.push("caller-finally", input); }
    same(caught, fail); const settlement: unknown[] = [fail ? "reject" : "resolve", fail ? reason : value];
    const expected: unknown[] = mode === "settled" ? [...settlement] : [];
    expected.push("call", input, "entered", input, "pending", input); if (mode === "pending") expected.push(...settlement);
    expected.push(fail ? "rejected" : "resumed", fail ? reason : value, "finally", input, fail ? "caught" : "received", fail ? reason : value, "caller-finally", input);
    assert.compareArray(log, expected);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));

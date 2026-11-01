/*---
description: Promise.resolve through a generic Promise parameter preserves native identity and both awaits of settled or pending promises.
features: [ts-async-route-values-thenables, ts-async, ts-generics, ts-functions, ts-function-types, ts-errors, ts-unknown]
flags: [async]
---*/
// Route: Promise<T> enters Promise.resolve unchanged; two awaits observe the same fulfilled value or rejection.
type AwaitValue = number | string | undefined | { id: number };
const log: unknown[] = [];
function same(actual: unknown, wanted: unknown): void { assert.sameValue(Object.is(actual, wanted), true); assert.sameValue(typeof actual, typeof wanted); assert.sameValue(actual instanceof Error, wanted instanceof Error); if (actual instanceof Error && wanted instanceof Error) assert.sameValue(actual.message, wanted.message); }
function adopt<T>(source: Promise<T>): Promise<T> { return Promise.resolve(source); }
async function main(): Promise<void> {
  const object = { id: 1 }, other = { id: 2 };
  const inputs: [AwaitValue, AwaitValue, unknown][] = [[7, -0, new RangeError("route")], [-0, "late", "reason"], ["中", undefined, -0], [undefined, other, undefined], [object, 7, { id: 3 }]];
  for (const [value, alternate, reason] of inputs) for (const queued of [false, true]) for (const fail of [false, true]) {
    log.length = 0; let state = 0;
    const source = new Promise<AwaitValue>((resolve, reject) => {
      const settle = (): void => { state++; log.push(fail ? "reject" : "resolve", fail ? reason : value, state); if (fail) reject(reason); else resolve(value); };
      if (queued) queueMicrotask(settle); else settle();
    });
    log.push("adopt", source, state); const adopted = adopt(source); log.push("adopted", adopted, state);
    same(adopted, source); assert.sameValue(typeof adopted, "object");
    for (const turn of [1, 2]) {
      log.push("await", turn); let caught = false;
      try { const result = await adopted; log.push("resumed", result, turn); same(result, value); }
      catch (error: unknown) { caught = true; log.push("caught", error, turn); same(error, reason); }
      finally { log.push("finally", state, turn); }
      same(caught, fail); same(state, 1);
    }
    const settlement: unknown[] = [fail ? "reject" : "resolve", fail ? reason : value, 1], expected: unknown[] = queued ? [] : [...settlement];
    expected.push("adopt", source, queued ? 0 : 1, "adopted", source, queued ? 0 : 1, "await", 1); if (queued) expected.push(...settlement);
    expected.push(fail ? "caught" : "resumed", fail ? reason : value, 1, "finally", 1, 1, "await", 2, fail ? "caught" : "resumed", fail ? reason : value, 2, "finally", 1, 2);
    assert.compareArray(log, expected);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));

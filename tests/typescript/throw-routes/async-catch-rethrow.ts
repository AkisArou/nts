/*---
description: An awaited catch reaches a typed handler that rethrows the original error.
features: [ts-throw-route-async, ts-async, ts-errors, ts-unknown, ts-function-types, ts-this-parameter]
flags: [async]
---*/
// Route: awaited catch into a typed rethrowing handler; node preserves the original fault identity in the awaiting caller catch and follows the logged cleanup order.
async function main(): Promise<void> {
  for (const n of [-2, 0, 3]) {
    const log: string[] = []; let state = 0;
    const fault = new RangeError("rejection fault");
    function checkFault(error: unknown): void {
      assert.sameValue(error, fault); assert.sameValue(error instanceof RangeError, true);
      if (error instanceof RangeError) { assert.sameValue(error.constructor, RangeError); assert.sameValue(error.message, "rejection fault"); }
    }
    function rejectedBody(this: void, error: unknown): never {
      assert.sameValue(this, undefined); checkFault(error); state++; log.push(`rejected:${arguments.length}:${state}`);
      try { log.push(`rethrow:${state}`); throw error; }
      finally { state += 10; log.push(`handler-finally:${state}`); }
    }
    const rejected: (this: void, error: unknown) => never = rejectedBody;
    let result: number | undefined; let caught = false;
    try {
      try { log.push("route:0"); result = await (n < 0 ? Promise.reject<number>(fault) : Promise.resolve(n)).catch(rejected); log.push(`after:${state}`); }
      finally { state += 100; log.push(`caller-finally:${state}`); }
    } catch (error: unknown) { checkFault(error); caught = true; log.push(`catch:${state}`); }
    finally { state += 1000; log.push(`outer-finally:${state}`); }
    assert.sameValue(result, n < 0 ? undefined : n); assert.sameValue(caught, n < 0);
    const handled = n < 0 ? 11 : 0; assert.sameValue(state, handled + 1100);
    const expected = ["route:0"];
    if (n < 0) expected.push("rejected:1:1", "rethrow:1", "handler-finally:11"); else expected.push("after:0");
    expected.push(`caller-finally:${handled + 100}`); if (n < 0) expected.push(`catch:${handled + 100}`);
    expected.push(`outer-finally:${handled + 1100}`); assert.compareArray(log, expected);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));

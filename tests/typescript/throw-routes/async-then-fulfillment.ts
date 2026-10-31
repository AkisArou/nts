/*---
description: An awaited then reaches a typed fulfillment handler that can throw.
features: [ts-throw-route-async, ts-async, ts-errors, ts-unknown, ts-function-types, ts-this-parameter]
flags: [async]
---*/
// Route: awaited then into a typed fulfillment handler; node preserves the original fault identity in the awaiting caller catch and follows the logged cleanup order.
type Handler = (this: void, value: number) => number;
async function main(): Promise<void> {
  for (const n of [-2, 0, 3]) {
    const log: string[] = []; let state = 0;
    const fault = new RangeError("fulfillment fault");
    function fulfilledBody(this: void, value: number): number {
      assert.sameValue(this, undefined); state++; log.push(`fulfilled:${value}:${arguments.length}:${state}`);
      try {
        if (value < 0) { log.push(`throw:${state}`); throw fault; }
        log.push(`return:${state}`); return value * 2;
      } finally { state += 10; log.push(`handler-finally:${state}`); }
    }
    const handler: Handler = fulfilledBody;
    let result: number | undefined; let caught = false;
    try {
      try { log.push("route:0"); result = await Promise.resolve(n).then(handler); log.push(`after:${state}`); }
      finally { state += 100; log.push(`caller-finally:${state}`); }
    } catch (error: unknown) {
      assert.sameValue(error, fault); assert.sameValue(error instanceof RangeError, true);
      if (error instanceof RangeError) { assert.sameValue(error.constructor, RangeError); assert.sameValue(error.message, "fulfillment fault"); }
      caught = true; log.push(`catch:${state}`);
    } finally { state += 1000; log.push(`outer-finally:${state}`); }
    assert.sameValue(result, n < 0 ? undefined : n * 2); assert.sameValue(caught, n < 0);
    assert.sameValue(state, 1111);
    const expected = ["route:0", `fulfilled:${n}:1:1`, n < 0 ? "throw:1" : "return:1", "handler-finally:11"];
    if (n >= 0) expected.push("after:11");
    expected.push("caller-finally:111"); if (n < 0) expected.push("catch:111");
    expected.push("outer-finally:1111"); assert.compareArray(log, expected);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));

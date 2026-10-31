/*---
description: Control for async-finally-replacement; the named producer is awaited directly and an explicit finally calls the named cleanup body.
features: [ts-throw-route-async, ts-async, ts-errors, ts-unknown, ts-function-types, ts-this-parameter]
flags: [async]
---*/
// Control: ../throw-routes/async-finally-replacement.ts; the named producer is awaited directly and an explicit finally calls the named cleanup body.
async function main(): Promise<void> {
  for (const n of [-2, 0, 3]) {
    const log: string[] = []; let state = 0;
    const fault = new RangeError("original fault"); const replacement = new TypeError("replacement fault");
    async function producerBody(input: number): Promise<number> {
      state++; log.push(`produce:${input}:${arguments.length}:${state}`);
      try {
        await Promise.resolve();
        if (input < 0) { log.push(`throw:${state}`); throw fault; }
        log.push(`return:${state}`); return input * 2;
      } finally { state += 10; log.push(`producer-finally:${state}`); }
    }
    function cleanupBody(this: void): number {
      assert.sameValue(this, undefined); state += 100; log.push(`cleanup:${arguments.length}:${state}`);
      try { if (n < 0) { log.push(`replace:${state}`); throw replacement; } log.push(`cleanup-return:${state}`); return 99; }
      finally { state += 1000; log.push(`cleanup-finally:${state}`); }
    }
    const producer: (input: number) => Promise<number> = producerBody, cleanup: (this: void) => number = cleanupBody;
    let result: number | undefined; let caught = false;
    try {
      try { log.push("route:0"); let value: number | undefined; try { value = await producerBody(n); } finally { cleanupBody(); } result = value; log.push(`after:${state}`); }
      finally { state += 10000; log.push(`caller-finally:${state}`); }
    } catch (error: unknown) {
      assert.sameValue(error, replacement); assert.sameValue(error instanceof TypeError, true);
      if (error instanceof TypeError) { assert.sameValue(error.constructor, TypeError); assert.sameValue(error.message, "replacement fault"); }
      caught = true; log.push(`catch:${state}`);
    } finally { state += 100000; log.push(`outer-finally:${state}`); }
    assert.sameValue(result, n < 0 ? undefined : n * 2); assert.sameValue(caught, n < 0);
    assert.sameValue(state, 111111);
    const expected = ["route:0", `produce:${n}:1:1`, n < 0 ? "throw:1" : "return:1", "producer-finally:11", "cleanup:0:111", n < 0 ? "replace:111" : "cleanup-return:111", "cleanup-finally:1111"];
    if (n >= 0) expected.push("after:1111");
    expected.push("caller-finally:11111"); if (n < 0) expected.push("catch:11111");
    expected.push("outer-finally:111111"); assert.compareArray(log, expected);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));

/*---
description: Promise.any preserves both typed producer faults inside the exact observed AggregateError.
features: [ts-throw-route-async, ts-async, ts-errors, ts-unknown, ts-interfaces, ts-function-types, ts-this-parameter, ts-arrays]
flags: [async]
---*/
// Route: typed async producers through Promise.any and its aggregate observer; node preserves the observed aggregate and member identities in the awaiting caller catch and follows the logged cleanup order.
interface Producer { (this: void, label: "a" | "b"): Promise<number>; }
function checkMember(error: unknown, original: RangeError, message: string): void {
  assert.sameValue(error, original); assert.sameValue(error instanceof RangeError, true);
  if (error instanceof RangeError) { assert.sameValue(error.constructor, RangeError); assert.sameValue(error.message, message); }
}
async function main(): Promise<void> {
  for (const n of [-2, 0, 3]) {
    const log: string[] = []; let state = 0; let observed: unknown;
    const fault = new RangeError("member:a"), secondFault = new RangeError("member:b");
    async function producerBody(this: void, label: "a" | "b"): Promise<number> {
      assert.sameValue(this, undefined); state++; log.push(`enter:${label}:${arguments.length}:${state}`);
      try { await Promise.resolve();
        if (n < 0) { log.push(`throw:${label}:${state}`); throw label === "a" ? fault : secondFault; }
        const value = (n + (label === "a" ? 0 : 1)) * 2; log.push(`return:${label}:${value}:${state}`); return value;
      } finally { state += 10; log.push(`producer-finally:${label}:${state}`); }
    }
    function checkAggregate(error: unknown): void {
      assert.sameValue(error instanceof AggregateError, true);
      if (error instanceof AggregateError) {
        assert.sameValue(error.constructor, AggregateError); assert.sameValue(error.message, "All promises were rejected");
        const reasons: readonly unknown[] = error.errors; assert.compareArray(reasons, [fault, secondFault]);
        checkMember(reasons[0], fault, "member:a"); checkMember(reasons[1], secondFault, "member:b");
      }
    }
    function observe(this: void, error: unknown): never {
      assert.sameValue(this, undefined); checkAggregate(error); observed = error; state += 100;
      log.push(`aggregate:${arguments.length}:${state}`); throw error;
    }
    const producer: Producer = producerBody; let result: number | undefined; let caught = false;
    try {
      try { log.push("route:0"); result = await Promise.any([producer("a"), producer("b")]).catch(observe); log.push(`after:${state}`); }
      finally { state += 1000; log.push(`caller-finally:${state}`); }
    } catch (error: unknown) { assert.sameValue(error, observed); checkAggregate(error); caught = true; log.push(`catch:${state}`); }
    finally { state += 10000; log.push(`outer-finally:${state}`); }
    assert.sameValue(result, n < 0 ? undefined : n * 2); assert.sameValue(observed === undefined, n >= 0); assert.sameValue(caught, n < 0);
    const stopped = n < 0 ? 122 : 22; assert.sameValue(state, stopped + 11000);
    const expected = ["route:0", "enter:a:1:1", "enter:b:1:2", n < 0 ? "throw:a:2" : `return:a:${n * 2}:2`, "producer-finally:a:12",
      n < 0 ? "throw:b:12" : `return:b:${(n + 1) * 2}:12`, "producer-finally:b:22"];
    if (n < 0) expected.push("aggregate:1:122"); if (n >= 0) expected.push("after:22");
    expected.push(`caller-finally:${stopped + 1000}`); if (n < 0) expected.push(`catch:${stopped + 1000}`);
    expected.push(`outer-finally:${stopped + 11000}`); assert.compareArray(log, expected);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));

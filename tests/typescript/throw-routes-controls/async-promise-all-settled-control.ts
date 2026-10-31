/*---
description: Control for async-promise-all-settled; the combinator and observers stay intact while both named async producer bodies are called directly.
features: [ts-throw-route-async, ts-async, ts-errors, ts-unknown, ts-interfaces, ts-function-types, ts-this-parameter, ts-arrays]
flags: [async]
---*/
// Control: ../throw-routes/async-promise-all-settled.ts; the combinator and observers stay intact while both named async producer bodies are called directly.
interface Producer { (this: void, label: "a" | "b"): Promise<number>; }
function checkMember(error: unknown, original: RangeError, message: string): void {
  assert.sameValue(error, original); assert.sameValue(error instanceof RangeError, true);
  if (error instanceof RangeError) { assert.sameValue(error.constructor, RangeError); assert.sameValue(error.message, message); }
}
async function main(): Promise<void> {
  for (const n of [-2, 0, 3]) {
    const log: string[] = []; let state = 0;
    const fault = new RangeError("member:a"), secondFault = new RangeError("member:b");
    async function producerBody(this: void, label: "a" | "b"): Promise<number> {
      assert.sameValue(this, undefined); state++; log.push(`enter:${label}:${arguments.length}:${state}`);
      try { await Promise.resolve();
        if (n < 0 && label === "a") { log.push(`throw:${label}:${state}`); throw label === "a" ? fault : secondFault; }
        const value = (n + (label === "a" ? 0 : 1)) * 2; log.push(`return:${label}:${value}:${state}`); return value;
      } finally { state += 10; log.push(`producer-finally:${label}:${state}`); }
    }
    const producer: Producer = producerBody; let result: number[] | undefined; let caught = false;
    try {
      try { log.push("route:0"); const settled = await Promise.allSettled([producerBody("a"), producerBody("b")]); assert.sameValue(settled.length, 2);
        const first = settled[0], second = settled[1]; assert.sameValue(second.status, "fulfilled");
        if (second.status === "fulfilled") assert.sameValue(second.value, (n + 1) * 2);
        if (first.status === "rejected") { const reason: unknown = first.reason; checkMember(reason, fault, "member:a"); state += 100; log.push(`settled-rethrow:${state}`); throw reason; }
        result = [first.value, second.status === "fulfilled" ? second.value : -99]; log.push(`after:${state}`); }
      finally { state += 1000; log.push(`caller-finally:${state}`); }
    } catch (error: unknown) { checkMember(error, fault, "member:a"); caught = true; log.push(`catch:${state}`); }
    finally { state += 10000; log.push(`outer-finally:${state}`); }
    assert.compareArray(result ?? [], n < 0 ? [] : [n * 2, (n + 1) * 2]);
    assert.sameValue(result === undefined, n < 0); assert.sameValue(caught, n < 0);
    const stopped = n < 0 ? 122 : 22; assert.sameValue(state, stopped + 11000);
    const expected = ["route:0", "enter:a:1:1", "enter:b:1:2", n < 0 ? "throw:a:2" : `return:a:${n * 2}:2`, "producer-finally:a:12",
      `return:b:${(n + 1) * 2}:12`, "producer-finally:b:22"];
    if (n < 0) expected.push("settled-rethrow:122"); if (n >= 0) expected.push("after:22");
    expected.push(`caller-finally:${stopped + 1000}`); if (n < 0) expected.push(`catch:${stopped + 1000}`);
    expected.push(`outer-finally:${stopped + 11000}`); assert.compareArray(log, expected);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));

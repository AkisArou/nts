/*---
description: Control for async-interface-function; the same throwing body is called directly in the caller try.
features: [ts-throw-route-async, ts-async, ts-errors, ts-unknown, ts-interfaces, ts-function-types, ts-this-parameter]
flags: [async]
---*/
// Control: ../throw-routes/async-interface-function.ts; the same throwing body is called directly in the caller try.
interface Operation { (this: void, input: number, fault: RangeError): Promise<number>; }
const log: string[] = [];
let state = 0;
async function workBody(this: void, input: number, fault: RangeError): Promise<number> {
  assert.sameValue(this, undefined); state++; log.push(`enter:${input}:${arguments.length}:${state}`);
  try {
    await Promise.resolve(); log.push(`resume:${state}`);
    if (input < 0) { log.push(`throw:${state}`); throw fault; }
    log.push(`return:${state}`); return input * 2;
  } finally { state += 10; log.push(`body-finally:${state}`); }
}
async function main(): Promise<void> {
  for (const n of [-2, 0, 3]) {
    log.length = 0; state = 0; const fault = new RangeError("async fault");
    const operation: Operation = workBody;
    let result: number | undefined; let caught = false;
    try {
      try { log.push("route:0"); result = await workBody(n, fault); log.push(`after:${state}`); }
      finally { state += 100; log.push(`caller-finally:${state}`); }
    } catch (error: unknown) {
      assert.sameValue(error, fault); assert.sameValue(error instanceof RangeError, true);
      if (error instanceof RangeError) { assert.sameValue(error.constructor, RangeError); assert.sameValue(error.message, "async fault"); }
      caught = true; log.push(`catch:${state}`);
    } finally { state += 1000; log.push(`outer-finally:${state}`); }
    assert.sameValue(result, n < 0 ? undefined : n * 2); assert.sameValue(caught, n < 0);
    assert.sameValue(state, 1111);
    const expected = ["route:0", `enter:${n}:2:1`, "resume:1", n < 0 ? "throw:1" : "return:1", "body-finally:11"];
    if (n >= 0) expected.push("after:11");
    expected.push("caller-finally:111"); if (n < 0) expected.push("catch:111");
    expected.push("outer-finally:1111"); assert.compareArray(log, expected);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));

/*---
description: Control for implicit-array-for-each; the same throwing body is called directly in the caller try.
features: [ts-throw-route-implicit, ts-errors, ts-unknown, ts-function-types, ts-this-parameter, ts-functions, ts-arrays]
---*/
// Control: ../throw-routes/implicit-array-for-each.ts; replace the implicit route with direct named-body calls.
type RouteCallback = (this: void, value: number, index: number, array: number[]) => void;
for (const failAt of [-1, 0, 1]) {
  const log: string[] = []; let state = 0;
  const fault = new RangeError(`fault:${failAt}`), source: number[] = [4, 7];
  function callbackBody(this: void, value: number, index: number, array: number[]): void {
    assert.sameValue(this, undefined); assert.sameValue(array, source);
    state++; log.push(`${value}:${index}:${arguments.length}:${state}`);
    try {
      if (index === failAt) { log.push(`throw:${state}`); throw fault; }
      log.push(`return:${state}`); return undefined;
    } finally { state += 10; log.push(`body-finally:${state}`); }
  }
  const callback: RouteCallback = callbackBody;
  let result: string | undefined; let caught = false;
  try {
    try { log.push("route:0"); callbackBody(source[0], 0, source); assert.sameValue(callbackBody(source[1], 1, source), undefined); result = "finished"; log.push(`after:${state}`); }
    finally { state += 100; log.push(`caller-finally:${state}`); }
  } catch (error: unknown) {
    assert.sameValue(error, fault); assert.sameValue(error instanceof RangeError, true);
    if (error instanceof RangeError) { assert.sameValue(error.constructor, RangeError); assert.sameValue(error.message, `fault:${failAt}`); }
    caught = true; log.push(`catch:${state}`);
  } finally { state += 1000; log.push(`outer-finally:${state}`); }
  assert.sameValue(result, failAt < 0 ? "finished" : undefined);
  assert.sameValue(result === undefined, failAt >= 0); assert.sameValue(caught, failAt >= 0);
  const stopped = failAt === 0 ? 11 : 22;
  assert.sameValue(state, stopped + 1100);
  const expected = ["route:0", "4:0:3:1", failAt === 0 ? "throw:1" : "return:1", "body-finally:11"];
  if (failAt !== 0) expected.push("7:1:3:12", failAt === 1 ? "throw:12" : "return:12", "body-finally:22");
  if (failAt < 0) expected.push("after:22");
  expected.push(`caller-finally:${stopped + 100}`); if (failAt >= 0) expected.push(`catch:${stopped + 100}`);
  expected.push(`outer-finally:${stopped + 1100}`); assert.compareArray(log, expected);
}

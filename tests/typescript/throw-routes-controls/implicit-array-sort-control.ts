/*---
description: Control for implicit-array-sort; the same throwing body is called directly in the caller try.
features: [ts-throw-route-implicit, ts-errors, ts-unknown, ts-arrays, ts-function-types, ts-functions, ts-this-parameter]
---*/
// Control: ../throw-routes/implicit-array-sort.ts; replace the implicit route with direct named-body calls.
type RouteComparator = (this: void, left: number, right: number) => number;
for (const n of [-2, 0, 3]) {
  const log: string[] = []; let state = 0;
  const fault = new RangeError(`fault:${n}`), source = [n + 4, n + 1];
  function compareBody(this: void, left: number, right: number): number {
    assert.sameValue(this, undefined); state++;
    log.push(`${left}:${right}:${arguments.length}:${state}`);
    try {
      if (n < 0) { log.push(`throw:${state}`); throw fault; }
      log.push(`return:${state}`); return left - right;
    } finally { state += 10; log.push(`body-finally:${state}`); }
  }
  const callback: RouteComparator = compareBody;
  let result: number[] | undefined; let caught = false;
  try {
    try { log.push("route:0"); const order = compareBody(source[1], source[0]); if (order < 0) { const first = source[0]; source[0] = source[1]; source[1] = first; } result = source; log.push(`after:${state}`); }
    finally { state += 100; log.push(`caller-finally:${state}`); }
  } catch (error: unknown) {
    assert.sameValue(error, fault); assert.sameValue(error instanceof RangeError, true);
    if (error instanceof RangeError) { assert.sameValue(error.constructor, RangeError); assert.sameValue(error.message, `fault:${n}`); }
    caught = true; log.push(`catch:${state}`);
  } finally { state += 1000; log.push(`outer-finally:${state}`); }
  assert.sameValue(result, n < 0 ? undefined : source); assert.sameValue(caught, n < 0);
  assert.compareArray(source, n < 0 ? [n + 4, n + 1] : [n + 1, n + 4]);
  assert.sameValue(state, 1111);
  const expected = ["route:0", `${n + 1}:${n + 4}:2:1`, n < 0 ? "throw:1" : "return:1", "body-finally:11"];
  if (n >= 0) expected.push("after:11");
  expected.push("caller-finally:111"); if (n < 0) expected.push("catch:111");
  expected.push("outer-finally:1111"); assert.compareArray(log, expected);
}

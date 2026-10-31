/*---
description: Control for throw-array-sort; the route is replaced by its plain counterpart.
features: [ts-call-route-throw, ts-functions, ts-function-types, ts-errors, ts-unknown, ts-arrays, ts-this-parameter]
---*/
// Control: ../call-routes/throw-array-sort.ts; only the comparator throw is disabled.
const log: string[] = [];
const receivers: unknown[] = [];
let state = 0;
const raises = false;
function target(this: void, left: number, right: number): number {
  receivers.push(this); log.push(`arg:${left}:${right}:${state}`);
  state = left + right; log.push(`write:${state}`);
  try {
    if (raises && left < 0) { log.push(`throw:${state}`); throw new RangeError(`route:${left}`); }
    return left - right;
  } finally { state += 10; log.push(`callee-finally:${state}`); }
}
const callback: (left: number, right: number) => number = target;
for (const n of [-2, -1, 0, 3]) {
  log.length = 0; receivers.length = 0; state = 0;
  let rethrown: unknown;
  const items = [n + 1, n];
  try {
    try {
      const result = items.sort(callback);
      assert.compareArray(result, [n, n + 1]); assert.sameValue(result, items);
      log.push(`return:${result.join(",")}:${state}`);
    } catch (error) { rethrown = error; state++; log.push(`inner-catch:${state}`); throw error; }
    finally { state += 100; log.push(`inner-finally:${state}`); }
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    assert.sameValue(error.constructor, RangeError);
    assert.sameValue(error.message, `route:${n}`);
    assert.sameValue(error, rethrown);
    state += 1000; log.push(`outer-catch:${state}`);
  } finally { state += 10000; log.push(`outer-finally:${state}`); }
  assert.compareArray(receivers, [undefined]);
  assert.sameValue(state, 2 * n + 11 + (raises && n < 0 ? 11101 : 10100));
  assert.compareArray(items, raises && n < 0 ? [n + 1, n] : [n, n + 1]);
  const expected: string[] = [`arg:${n}:${n + 1}:0`, `write:${2 * n + 1}`];
  if (raises && n < 0) expected.push(`throw:${2 * n + 1}`);
  expected.push(`callee-finally:${2 * n + 11}`);
  if (raises && n < 0) expected.push(`inner-catch:${2 * n + 11 + 1}`, `inner-finally:${2 * n + 11 + 101}`,
    `outer-catch:${2 * n + 11 + 1101}`, `outer-finally:${2 * n + 11 + 11101}`);
  else expected.push(`return:${n},${n + 1}:${2 * n + 11}`, `inner-finally:${2 * n + 11 + 100}`, `outer-finally:${2 * n + 11 + 10100}`);
  assert.compareArray(log, expected);
}

/*---
description: A typed reducer carries its accumulator, array arguments and throw through nested handlers.
features: [ts-call-route-throw, ts-functions, ts-function-types, ts-errors, ts-unknown, ts-arrays, ts-this-parameter]
---*/
// Route: reduce invokes a function-typed reducer; node preserves the accumulator and state before unwinding.
const log: string[] = [];
const receivers: unknown[] = [];
let state = 0;
let current: number[] = [];
function target(this: void, sum: number, value: number, index: number, all: number[]): number {
  receivers.push(this); assert.sameValue(all, current);
  log.push(`arg:${sum}:${value}:${index}:${all.length}:${state}`);
  state += value + index; log.push(`write:${state}`);
  try {
    if (value < 0) { log.push(`throw:${state}`); throw new RangeError(`route:${value}`); }
    return sum + value;
  } finally { state += 10; log.push(`callee-finally:${state}`); }
}
const callback: (sum: number, value: number, index: number, all: number[]) => number = target;
for (const n of [-2, -1, 0, 3]) {
  log.length = 0; receivers.length = 0; state = 0;
  let rethrown: unknown;
  const items = [n + 1, n]; current = items;
  const after = n < -1 ? n + 11 : 2 * n + 22;
  try {
    try {
      const result = items.reduce(callback, 5);
      assert.sameValue(result, 2 * n + 6);
      log.push(`return:${result}:${state}`);
    } catch (error) { rethrown = error; state++; log.push(`inner-catch:${state}`); throw error; }
    finally { state += 100; log.push(`inner-finally:${state}`); }
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    assert.sameValue(error.constructor, RangeError);
    assert.sameValue(error.message, `route:${n < -1 ? n + 1 : n}`);
    assert.sameValue(error, rethrown);
    state += 1000; log.push(`outer-catch:${state}`);
  } finally { state += 10000; log.push(`outer-finally:${state}`); }
  assert.compareArray(receivers, n < -1 ? [undefined] : [undefined, undefined]);
  assert.sameValue(state, after + (n < 0 ? 11101 : 10100));
  assert.compareArray(items, [n + 1, n]);
  const expected: string[] = [`arg:5:${n + 1}:0:2:0`, `write:${n + 1}`];
  if (n < -1) expected.push(`throw:${n + 1}`);
  expected.push(`callee-finally:${n + 11}`);
  if (n >= -1) {
    expected.push(`arg:${6 + n}:${n}:1:2:${n + 11}`, `write:${2 * n + 12}`);
    if (n === -1) expected.push(`throw:${2 * n + 12}`);
    expected.push(`callee-finally:${2 * n + 22}`);
  }
  if (n < 0) expected.push(`inner-catch:${after + 1}`, `inner-finally:${after + 101}`,
    `outer-catch:${after + 1101}`, `outer-finally:${after + 11101}`);
  else expected.push(`return:${2 * n + 6}:${after}`, `inner-finally:${after + 100}`, `outer-finally:${after + 10100}`);
  assert.compareArray(log, expected);
}

/*---
description: Control for throw-map; the route is replaced by its plain counterpart.
features: [ts-call-route-throw, ts-functions, ts-function-types, ts-errors, ts-unknown, ts-map-set, ts-this-parameter]
---*/
// Control: ../call-routes/throw-map.ts; only the call route is removed.
const log: string[] = [];
const receivers: unknown[] = [];
let state = 0;
function target(this: unknown, value: number): number {
  receivers.push(this); log.push(`arg:${value}:${state}`);
  state = value; log.push(`write:${state}`);
  try {
    if (value < 0) { log.push(`throw:${state}`); throw new RangeError(`route:${value}`); }
    return value * 2;
  } finally { state += 10; log.push(`callee-finally:${state}`); }
}
const callbacks = new Map<string, (value: number) => number>([["run", target]]);
for (const n of [-2, -1, 0, 3]) {
  log.length = 0; receivers.length = 0; state = 0;
  let rethrown: unknown;
  const callback = callbacks.get("run");
  if (callback === undefined) throw new Error("missing callback");
  try {
    try {
      const result = target(n);
      assert.sameValue(result, n * 2);
      log.push(`return:${result}:${state}`);
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
  assert.sameValue(state, n + 10 + (n < 0 ? 11101 : 10100));
  const expected: string[] = [];
  expected.push(`arg:${n}:0`, `write:${n}`);
  if (n < 0) expected.push(`throw:${n}`);
  expected.push(`callee-finally:${n + 10}`);
  if (n < 0) expected.push(`inner-catch:${n + 10 + 1}`, `inner-finally:${n + 10 + 101}`,
    `outer-catch:${n + 10 + 1101}`, `outer-finally:${n + 10 + 11101}`);
  else expected.push(`return:${n * 2}:${n + 10}`, `inner-finally:${n + 10 + 100}`, `outer-finally:${n + 10 + 10100}`);
  assert.compareArray(log, expected);
}

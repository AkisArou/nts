/*---
description: Control for throw-function-union; the route is replaced by its plain counterpart.
features: [ts-call-route-throw, ts-functions, ts-function-types, ts-errors, ts-unknown, ts-unions, ts-optional-parameters, ts-narrowing, ts-this-parameter]
---*/
// Control: ../call-routes/throw-function-union.ts; only the call route is removed.
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
type Choice = ((value: number | string) => number) | ((value: number | boolean, extra?: number) => number);
function text(value: number | string): number {
  log.push(`text:${value}`); return target(typeof value === "number" ? value : value.length);
}
function flag(value: number | boolean, extra?: number): number {
  log.push(`flag:${value}:${extra}`); return target(typeof value === "number" ? value * 2 + (extra ?? 0) : Number(value));
}
for (const n of [-2, -1, 0, 3]) {
  log.length = 0; receivers.length = 0; state = 0;
  let rethrown: unknown;
  const callback: Choice = n % 2 === 0 ? text : flag;
  const value = n % 2 === 0 ? n : n * 2;
  try {
    try {
      const result = n % 2 === 0 ? text(n) : flag(n);
      assert.sameValue(result, value * 2);
      log.push(`return:${result}:${state}`);
    } catch (error) { rethrown = error; state++; log.push(`inner-catch:${state}`); throw error; }
    finally { state += 100; log.push(`inner-finally:${state}`); }
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    assert.sameValue(error.constructor, RangeError);
    assert.sameValue(error.message, `route:${value}`);
    assert.sameValue(error, rethrown);
    state += 1000; log.push(`outer-catch:${state}`);
  } finally { state += 10000; log.push(`outer-finally:${state}`); }
  assert.compareArray(receivers, [undefined]);
  assert.sameValue(state, value + 10 + (n < 0 ? 11101 : 10100));
  const expected: string[] = n % 2 === 0 ? [`text:${n}`] : [`flag:${n}:undefined`];
  expected.push(`arg:${value}:0`, `write:${value}`);
  if (n < 0) expected.push(`throw:${value}`);
  expected.push(`callee-finally:${value + 10}`);
  if (n < 0) expected.push(`inner-catch:${value + 10 + 1}`, `inner-finally:${value + 10 + 101}`,
    `outer-catch:${value + 10 + 1101}`, `outer-finally:${value + 10 + 11101}`);
  else expected.push(`return:${value * 2}:${value + 10}`, `inner-finally:${value + 10 + 100}`, `outer-finally:${value + 10 + 10100}`);
  assert.compareArray(log, expected);
}

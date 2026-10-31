/*---
description: Direct-call control for shape-rest-array; A rest implementation collects fixed arguments from a function type in a typed array route.
features: [ts-call-route-shape, ts-functions, ts-function-types, ts-errors, ts-iteration, ts-arrays, ts-rest-parameters]
---*/
// Control for ../call-routes/shape-rest-array.ts; only the call target is direct.
type Callback = (n: number, left: number, right: number) => number;
const log: string[] = [];
let state = 0;
function target(n: number, ...tail: number[]): number {
  assert.compareArray(tail, [n + 1, n + 2]);
  log.push(`args:${n}:${tail.length}:${tail.join(",")}`);
  state = n;
  if (n < 0) throw new RangeError(`negative:${n}`);
  return n + tail[0] * 10 + tail[1] * 100;
}
const handlers: Callback[] = [target];
for (const n of [-2, 0, 3]) {
  log.length = 0; state = 0;
  try {
    const result = target(n, n + 1, n + 2);
    log.push(`return:${result}:${state}`);
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    assert.sameValue(error.message, `negative:${n}`);
    log.push(`catch:${state}`);
  } finally { log.push(`finally:${state}`); }
  const expected = [`args:${n}:2:${n + 1},${n + 2}`];
  if (n < 0) expected.push(`catch:${n}`);
  else expected.push(`return:${n + (n + 1) * 10 + (n + 2) * 100}:${n}`);
  expected.push(`finally:${n}`);
  assert.compareArray(log, expected);
}

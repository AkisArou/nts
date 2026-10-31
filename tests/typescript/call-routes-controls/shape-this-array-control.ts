/*---
description: Direct-call control for shape-this-array; An explicit this parameter stays separate from the stored function type's ordinary arguments in a typed array route.
features: [ts-call-route-shape, ts-functions, ts-function-types, ts-errors, ts-iteration, ts-arrays, ts-this-parameter, ts-this]
---*/
// Control for ../call-routes/shape-this-array.ts; only the call target is direct.
type Callback = (n: number, scale: number) => number;
const log: string[] = [];
let state = 0;
function target(this: void, n: number, scale: number): number {
  assert.sameValue(this, undefined);
  log.push(`args:undefined:${n}:${scale}`);
  state = n;
  if (n < 0) throw new RangeError(`negative:${n}`);
  return n * scale;
}
const handlers: Callback[] = [target];
const invoke: Callback = handlers[0];
for (const n of [-2, 0, 3]) {
  log.length = 0; state = 0;
  try {
    const result = target(n, 3);
    log.push(`return:${result}:${state}`);
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    assert.sameValue(error.message, `negative:${n}`);
    log.push(`catch:${state}`);
  } finally { log.push(`finally:${state}`); }
  const expected = [`args:undefined:${n}:3`];
  if (n < 0) expected.push(`catch:${n}`);
  else expected.push(`return:${n * 3}:${n}`);
  expected.push(`finally:${n}`);
  assert.compareArray(log, expected);
}

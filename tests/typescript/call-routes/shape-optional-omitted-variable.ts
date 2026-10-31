/*---
description: A one-argument function type hides an optional second implementation parameter, which receives undefined.
features: [ts-call-route-shape, ts-functions, ts-function-types, ts-errors, ts-iteration, ts-arrays, ts-optional-parameters, ts-null-undefined]
---*/
// Route: one-argument function type -> optional second parameter; node supplies undefined.
type Callback = (n: number) => number;
const log: string[] = [];
let state = 0;
function target(n: number, extra?: number): number {
  log.push(`args:${n}:${String(extra)}`);
  state = n;
  if (n < 0) throw new RangeError(`negative:${n}`);
  return n + (extra ?? 10);
}
const invoke: Callback = target;
for (const n of [-2, 0, 3]) {
  log.length = 0; state = 0;
  try {
    const result = invoke(n);
    log.push(`return:${result}:${state}`);
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    assert.sameValue(error.message, `negative:${n}`);
    log.push(`catch:${state}`);
  } finally { log.push(`finally:${state}`); }
  const expected = [`args:${n}:undefined`];
  if (n < 0) expected.push(`catch:${n}`);
  else expected.push(`return:${n + 10}:${n}`);
  expected.push(`finally:${n}`);
  assert.compareArray(log, expected);
}

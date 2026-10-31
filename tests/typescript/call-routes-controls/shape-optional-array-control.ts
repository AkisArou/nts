/*---
description: Direct-call control for shape-optional-array; An optional implementation parameter receives a required possibly-undefined argument in a typed array route.
features: [ts-call-route-shape, ts-functions, ts-function-types, ts-errors, ts-iteration, ts-arrays, ts-optional-parameters, ts-null-undefined, ts-tuples]
---*/
// Control for ../call-routes/shape-optional-array.ts; only the call target is direct.
type Callback = (n: number, extra: number | undefined) => number;
const log: string[] = [];
let state = 0;
function target(n: number, extra?: number): number {
  log.push(`args:${n}:${String(extra)}`);
  state = n;
  if (n < 0) throw new RangeError(`negative:${n}`);
  return n + (extra ?? 10);
}
const handlers: Callback[] = [target];
const inputs: [number, number | undefined][] = [[-2, 8], [0, undefined], [3, 7], [5, 0]];
for (const [n, extra] of inputs) {
  log.length = 0; state = 0;
  try {
    const result = target(n, extra);
    log.push(`return:${result}:${state}`);
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    assert.sameValue(error.message, `negative:${n}`);
    log.push(`catch:${state}`);
  } finally { log.push(`finally:${state}`); }
  const expected = [`args:${n}:${String(extra)}`];
  if (n < 0) expected.push(`catch:${n}`);
  else expected.push(`return:${n + (extra ?? 10)}:${n}`);
  expected.push(`finally:${n}`);
  assert.compareArray(log, expected);
}

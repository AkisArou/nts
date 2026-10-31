/*---
description: Direct-call control for shape-default-omitted-variable; A one-argument function type hides a defaulted second implementation parameter and preserves its effect order.
features: [ts-call-route-shape, ts-functions, ts-function-types, ts-errors, ts-iteration, ts-arrays, ts-default-parameters]
---*/
// Control for ../call-routes/shape-default-omitted-variable.ts; only the call target is direct.
type Callback = (n: number) => number;
const log: string[] = [];
let state = 0;
let defaults = 0;
function first(n: number): number { log.push(`first:${n}`); return n; }
function next(): number { log.push("default"); return ++defaults; }
function target(n: number, extra: number = next()): number {
  log.push(`args:${n}:${extra}`);
  state = n;
  if (n < 0) throw new RangeError(`negative:${n}`);
  return n + extra;
}
const invoke: Callback = target;
let expectedDefaults = 0;
for (const n of [-2, 0, 3]) {
  log.length = 0; state = 0;
  const chosen = ++expectedDefaults;
  try {
    const result = target(first(n));
    log.push(`return:${result}:${state}`);
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    assert.sameValue(error.message, `negative:${n}`);
    log.push(`catch:${state}`);
  } finally { log.push(`finally:${state}`); }
  const expected = [`first:${n}`, "default"];
  expected.push(`args:${n}:${chosen}`);
  if (n < 0) expected.push(`catch:${n}`);
  else expected.push(`return:${n + chosen}:${n}`);
  expected.push(`finally:${n}`);
  assert.compareArray(log, expected);
  assert.sameValue(defaults, expectedDefaults);
}

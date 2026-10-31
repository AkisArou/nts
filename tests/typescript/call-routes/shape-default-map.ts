/*---
description: An effectful default runs after argument evaluation through a required-argument function type in a typed map route.
features: [ts-call-route-shape, ts-functions, ts-function-types, ts-errors, ts-iteration, ts-arrays, ts-default-parameters, ts-null-undefined, ts-tuples, ts-map-set]
---*/
// Route: typed map -> default implementation; node preserves arguments, results and caught state.
type Callback = (n: number, extra: number | undefined) => number;
const log: string[] = [];
let state = 0;
let defaults = 0;
function first(n: number): number { log.push(`first:${n}`); return n; }
function second(extra: number | undefined): number | undefined { log.push(`second:${String(extra)}`); return extra; }
function next(): number { log.push("default"); return ++defaults; }
function target(n: number, extra: number = next()): number {
  log.push(`args:${n}:${extra}`);
  state = n;
  if (n < 0) throw new RangeError(`negative:${n}`);
  return n + extra;
}
const handlers = new Map<string, Callback>();
handlers.set("run", target);
const invoke = handlers.get("run");
if (invoke === undefined) throw new Error("missing callback");
let expectedDefaults = 0;
const inputs: [number, number | undefined][] = [[-2, undefined], [0, 7], [3, undefined], [5, 0]];
for (const [n, extra] of inputs) {
  log.length = 0; state = 0;
  const chosen = extra === undefined ? ++expectedDefaults : extra;
  try {
    const result = invoke(first(n), second(extra));
    log.push(`return:${result}:${state}`);
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    assert.sameValue(error.message, `negative:${n}`);
    log.push(`catch:${state}`);
  } finally { log.push(`finally:${state}`); }
  const expected = [`first:${n}`, `second:${String(extra)}`];
  if (extra === undefined) expected.push("default");
  expected.push(`args:${n}:${chosen}`);
  if (n < 0) expected.push(`catch:${n}`);
  else expected.push(`return:${n + chosen}:${n}`);
  expected.push(`finally:${n}`);
  assert.compareArray(log, expected);
  assert.sameValue(defaults, expectedDefaults);
}

/*---
description: A one-parameter implementation receives both arguments through a wider function type in a typed field route.
features: [ts-call-route-shape, ts-functions, ts-function-types, ts-errors, ts-iteration, ts-arrays, ts-overloads, ts-unknown, ts-class, ts-class-fields]
---*/
// Route: typed field -> fewer implementation; node preserves arguments, results and caught state.
type Callback = (n: number, extra: string) => number;
const log: string[] = [];
let state = 0;
function target(n: number): number;
function target(n: number, extra: string): number;
function target(n: number): number {
  const extra: unknown = arguments[1];
  assert.sameValue(extra, `extra:${n}`);
  log.push(`args:${arguments.length}:${n}:${String(extra)}`);
  state = n;
  if (n < 0) throw new RangeError(`negative:${n}`);
  return n * 2;
}
class Holder { handler: Callback = target; }
const holder = new Holder();
for (const n of [-2, 0, 3]) {
  log.length = 0; state = 0;
  try {
    const result = holder.handler(n, `extra:${n}`);
    log.push(`return:${result}:${state}`);
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    assert.sameValue(error.message, `negative:${n}`);
    log.push(`catch:${state}`);
  } finally { log.push(`finally:${state}`); }
  const expected = [`args:2:${n}:extra:${n}`];
  if (n < 0) expected.push(`catch:${n}`);
  else expected.push(`return:${n * 2}:${n}`);
  expected.push(`finally:${n}`);
  assert.compareArray(log, expected);
}

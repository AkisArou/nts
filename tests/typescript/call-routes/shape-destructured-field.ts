/*---
description: A destructuring implementation receives object and tuple arguments through a function type in a typed field route.
features: [ts-call-route-shape, ts-functions, ts-function-types, ts-errors, ts-iteration, ts-arrays, ts-destructuring, ts-tuples, ts-objects, ts-class, ts-class-fields]
---*/
// Route: typed field -> destructured implementation; node preserves arguments, results and caught state.
type Payload = { value: number; offset: number };
type Callback = (payload: Payload, pair: [number, string]) => number;
const log: string[] = [];
let state = 0;
function target({ value, offset }: Payload, [scale, label]: [number, string]): number {
  log.push(`args:${value}:${offset}:${scale}:${label}`);
  state = value;
  if (value < 0) throw new RangeError(`negative:${value}`);
  return (value + offset) * scale;
}
class Holder { handler: Callback = target; }
const holder = new Holder();
for (const n of [-2, 0, 3]) {
  log.length = 0; state = 0;
  try {
    const result = holder.handler({ value: n, offset: n + 1 }, [2, `tag:${n}`]);
    log.push(`return:${result}:${state}`);
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    assert.sameValue(error.message, `negative:${n}`);
    log.push(`catch:${state}`);
  } finally { log.push(`finally:${state}`); }
  const expected = [`args:${n}:${n + 1}:2:tag:${n}`];
  if (n < 0) expected.push(`catch:${n}`);
  else expected.push(`return:${(n + n + 1) * 2}:${n}`);
  expected.push(`finally:${n}`);
  assert.compareArray(log, expected);
}

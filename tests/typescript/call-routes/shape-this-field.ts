/*---
description: An explicit this parameter stays separate from the stored function type's ordinary arguments in a typed field route.
features: [ts-call-route-shape, ts-functions, ts-function-types, ts-errors, ts-iteration, ts-arrays, ts-this-parameter, ts-this, ts-class, ts-class-fields]
---*/
// Route: typed field -> this implementation; node preserves arguments, results and caught state.
type Callback = (n: number, scale: number) => number;
const log: string[] = [];
let state = 0;
class Holder {
  offset: number = 10;
  handler: Callback = this.target;
  target(this: Holder, n: number, scale: number): number {
    assert.sameValue(this, holder);
    log.push(`args:this:${this.offset}:${n}:${scale}`);
    state = n;
    if (n < 0) throw new RangeError(`negative:${n}`);
    return this.offset + n * scale;
  }
}
const holder = new Holder();
for (const n of [-2, 0, 3]) {
  log.length = 0; state = 0;
  holder.offset = n + 10;
  try {
    const result = holder.handler(n, 3);
    log.push(`return:${result}:${state}`);
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    assert.sameValue(error.message, `negative:${n}`);
    log.push(`catch:${state}`);
  } finally { log.push(`finally:${state}`); }
  const expected = [`args:this:${n + 10}:${n}:3`];
  if (n < 0) expected.push(`catch:${n}`);
  else expected.push(`return:${n + 10 + n * 3}:${n}`);
  expected.push(`finally:${n}`);
  assert.compareArray(log, expected);
}

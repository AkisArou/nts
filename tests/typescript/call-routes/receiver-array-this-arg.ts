/*---
description: A typed class method passed to map receives thisArg and the array callback arguments on success and throw.
features: [ts-call-route-receiver, ts-functions, ts-function-types, ts-this, ts-errors, ts-class, ts-class-fields, ts-this-parameter, ts-arrays]
---*/
// Route: a declared method reaches map with thisArg; node stops on its deeper throw and preserves earlier state.
const log: string[] = [];
const receivers: Receiver[] = [];
let state = 0;
let current: number[] = [];
function finish(value: number): number {
  log.push(`body:${value}:${state}`);
  if (value < 0) throw new RangeError(`negative:${value}`);
  return state * 2;
}
class Receiver {
  base: number = 10;
  visit(this: Receiver, value: number, index: number, all: number[]): number {
    receivers.push(this); assert.sameValue(all, current);
    state += this.base + value + index;
    log.push(`visit:${value}:${index}:${all.length}:${state}`);
    if (value === -2) throw new RangeError(`negative:${value}`);
    return finish(value);
  }
}
const receiver = new Receiver();
for (const n of [-2, -1, 0, 3]) {
  log.length = 0; receivers.length = 0; state = 0;
  const items = [n, n + 1]; current = items;
  try {
    const result = items.map(receiver.visit, receiver);
    assert.compareArray(result, [2 * (10 + n), 2 * (22 + 2 * n)]);
    log.push(`return:${result.join(",")}:${state}`);
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    assert.sameValue(error.constructor, RangeError);
    assert.sameValue(error.message, `negative:${n}`);
    log.push(`catch:${state}`);
  } finally { state += 100; log.push(`finally:${state}`); }
  assert.compareArray(receivers, n < 0 ? [receiver] : [receiver, receiver]);
  assert.sameValue(state, n < 0 ? 110 + n : 122 + 2 * n);
  const expected = [`visit:${n}:0:2:${10 + n}`, `body:${n}:${10 + n}`];
  if (n === -2) expected.pop();
  if (n < 0) expected.push(`catch:${10 + n}`);
  else expected.push(`visit:${n + 1}:1:2:${22 + 2 * n}`, `body:${n + 1}:${22 + 2 * n}`,
    `return:${2 * (10 + n)},${2 * (22 + 2 * n)}:${22 + 2 * n}`);
  expected.push(`finally:${n < 0 ? 110 + n : 122 + 2 * n}`);
  assert.compareArray(log, expected);
}

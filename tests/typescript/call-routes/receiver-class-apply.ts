/*---
description: An extracted class method reaches its declared receiver through apply, including a deeper throw.
features: [ts-call-route-receiver, ts-functions, ts-function-types, ts-this, ts-errors, ts-class, ts-class-fields, ts-this-parameter, ts-tuples]
---*/
// Route: a typed extracted class method uses apply; node preserves its receiver, arguments and deeper throw.
const log: string[] = [];
let state = 0;
const receivers: unknown[] = [];
function finish(value: number): number {
  log.push(`body:${value}:${state}`);
  if (value < 0) throw new RangeError(`negative:${value}`);
  return state * 2;
}
class Receiver {
  base: number;
  constructor(base: number) { this.base = base; }
  method(this: Receiver, value: number, scale: number): number {
    receivers.push(this); state = this.base + value * scale;
    log.push(`method:${value}:${scale}:${state}`);
    if (value === -2) throw new RangeError(`negative:${value}`);
    return finish(value);
  }
}
const source = new Receiver(100);
const receiver = new Receiver(10);
const callback: (this: Receiver, value: number, scale: number) => number = source.method;
for (const n of [-2, -1, 0, 3]) {
  log.length = 0; state = 0; receivers.length = 0;
  const argumentsList: [number, number] = [n, 2];
  try {
    const result = callback.apply(receiver, argumentsList);
    assert.sameValue(result, 2 * (10 + 2 * n));
    log.push(`return:${result}:${state}`);
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    assert.sameValue(error.constructor, RangeError);
    assert.sameValue(error.message, `negative:${n}`);
    log.push(`catch:${state}`);
  } finally { state += 100; log.push(`finally:${state}`); }
  assert.compareArray(receivers, [receiver]);
  assert.sameValue(state, 10 + 2 * n + 100);
  const expected = [`method:${n}:2:${10 + 2 * n}`, `body:${n}:${10 + 2 * n}`];
  if (n === -2) expected.pop();
  expected.push(n < 0 ? `catch:${10 + 2 * n}` : `return:${2 * (10 + 2 * n)}:${10 + 2 * n}`);
  expected.push(`finally:${10 + 2 * n + 100}`);
  assert.compareArray(log, expected);
}

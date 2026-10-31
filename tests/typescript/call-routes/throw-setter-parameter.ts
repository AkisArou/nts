/*---
description: A setter reached through a function-typed parameter preserves its field write before throwing.
features: [ts-call-route-throw, ts-functions, ts-function-types, ts-errors, ts-unknown, ts-class, ts-class-fields, ts-accessors]
---*/
// Route: a typed callback parameter reaches a setter; node retains the assigned field after catch and finally.
const log: string[] = [];
const receivers: unknown[] = [];
let state = 0;
class Cell {
  stored: number = 0;
  set sample(value: number) {
    receivers.push(this); log.push(`arg:${value}:${state}`);
    this.stored = value; state = value; log.push(`write:${state}`);
    try {
      if (value < 0) { log.push(`throw:${state}`); throw new RangeError(`route:${value}`); }
    } finally { state += 10; log.push(`callee-finally:${state}`); }
  }
}
function write(cell: Cell, value: number): number { return (cell.sample = value, cell.stored * 2); }
function invoke(callback: (cell: Cell, value: number) => number, cell: Cell, value: number): number { return callback(cell, value); }
for (const n of [-2, -1, 0, 3]) {
  log.length = 0; receivers.length = 0; state = 0;
  let rethrown: unknown;
  const cell = new Cell();
  try {
    try {
      const result = invoke(write, cell, n);
      assert.sameValue(result, n * 2);
      log.push(`return:${result}:${state}`);
    } catch (error) { rethrown = error; state++; log.push(`inner-catch:${state}`); throw error; }
    finally { state += 100; log.push(`inner-finally:${state}`); }
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    assert.sameValue(error.constructor, RangeError);
    assert.sameValue(error.message, `route:${n}`);
    assert.sameValue(error, rethrown);
    state += 1000; log.push(`outer-catch:${state}`);
  } finally { state += 10000; log.push(`outer-finally:${state}`); }
  assert.compareArray(receivers, [cell]);
  assert.sameValue(state, n + 10 + (n < 0 ? 11101 : 10100));
  assert.sameValue(cell.stored, n);
  const expected: string[] = [];
  expected.push(`arg:${n}:0`, `write:${n}`);
  if (n < 0) expected.push(`throw:${n}`);
  expected.push(`callee-finally:${n + 10}`);
  if (n < 0) expected.push(`inner-catch:${n + 10 + 1}`, `inner-finally:${n + 10 + 101}`,
    `outer-catch:${n + 10 + 1101}`, `outer-finally:${n + 10 + 11101}`);
  else expected.push(`return:${n * 2}:${n + 10}`, `inner-finally:${n + 10 + 100}`, `outer-finally:${n + 10 + 10100}`);
  assert.compareArray(log, expected);
}

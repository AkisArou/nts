/*---
description: Control for throw-getter-parameter; the route is replaced by its plain counterpart.
features: [ts-call-route-throw, ts-functions, ts-function-types, ts-errors, ts-unknown, ts-class, ts-class-fields, ts-accessors]
---*/
// Control: ../call-routes/throw-getter-parameter.ts; only the call route is removed.
const log: string[] = [];
const receivers: unknown[] = [];
let state = 0;
class Cell {
  value: number = 0;
  reads: number = 0;
  get sample(): number {
    this.reads++; receivers.push(this); log.push(`arg:${this.value}:${state}`);
    state = this.value; log.push(`write:${state}`);
    try {
      if (this.value < 0) { log.push(`throw:${state}`); throw new RangeError(`route:${this.value}`); }
      return this.value * 2;
    } finally { state += 10; log.push(`callee-finally:${state}`); }
  }
}
function read(cell: Cell): number { return cell.sample; }
function invoke(callback: (cell: Cell) => number, cell: Cell): number { return callback(cell); }
for (const n of [-2, -1, 0, 3]) {
  log.length = 0; receivers.length = 0; state = 0;
  let rethrown: unknown;
  const cell = new Cell(); cell.value = n;
  try {
    try {
      const result = cell.sample;
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
  assert.sameValue(cell.reads, 1);
  const expected: string[] = [];
  expected.push(`arg:${n}:0`, `write:${n}`);
  if (n < 0) expected.push(`throw:${n}`);
  expected.push(`callee-finally:${n + 10}`);
  if (n < 0) expected.push(`inner-catch:${n + 10 + 1}`, `inner-finally:${n + 10 + 101}`,
    `outer-catch:${n + 10 + 1101}`, `outer-finally:${n + 10 + 11101}`);
  else expected.push(`return:${n * 2}:${n + 10}`, `inner-finally:${n + 10 + 100}`, `outer-finally:${n + 10 + 10100}`);
  assert.compareArray(log, expected);
}

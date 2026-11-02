/*---
description: Plain string-hook record control for An inherited spread getter controls concat through a base-class return while retaining the actual receiver.
features: [ts-symbol-route-well-known, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-unknown, ts-class, ts-class-fields, ts-inheritance, ts-this, ts-function-types, ts-index-signatures, ts-numbers, ts-record]
---*/
// String hook record: Base and child indexed objects return as BatchBase; node reads their inherited spread getter once and preserves holes or object identity.
const hookKey = "hook:concat", log: unknown[] = [];
class BatchBase {
  length: number; spread: boolean; keys: string[] = [hookKey]; [index: number]: number;
  constructor(values: number[], spread: boolean) {
    this.length = values.length; this.spread = spread; for (let i = 0; i < values.length; i++) if (i in values) this[i] = values[i];
  }
}
class BatchChild extends BatchBase { child: boolean = true; }
const hooks: Record<string, (self: BatchBase) => boolean> = { [hookKey]: self => { log.push(self, self.spread); return self.spread; } };
function make(values: number[], spread: boolean, child: boolean): BatchBase { return child ? new BatchChild(values, spread) : new BatchBase(values, spread); }
function concatenate(target: BatchBase): unknown[] {
  const spread = target.keys.includes(hookKey) && hooks[hookKey](target), out: unknown[] = ["start"];
  if (!spread) { out.push(target); return out; } out.length = target.length + 1;
  for (let i = 0; i < target.length; i++) if (i in target) out[i + 1] = target[i]; return out;
}
const sparse: number[] = [3]; sparse.length = 3; sparse[2] = 9;
const inputs: number[][] = [[], [-0, NaN], sparse];
for (const values of inputs) for (const spread of [false, true]) for (const child of [false, true]) {
  log.length = 0; const target = make(values, spread, child), result = concatenate(target), expected: unknown[] = ["start"];
  if (spread) { expected.length = values.length + 1; for (let i = 0; i < values.length; i++) if (i in values) expected[i + 1] = values[i]; }
  else expected.push(target);
  assert.compareArray(result, expected); assert.compareArray(Object.keys(result), Object.keys(expected));
  assert.compareArray(log, [target, spread]); assert.sameValue(target.length, values.length); assert.sameValue(target.spread, spread);
  for (let i = 0; i < values.length; i++) { assert.sameValue(target[i], values[i]); assert.sameValue(i in target, i in values); }
  if (!spread) assert.sameValue(result[1], target);
}

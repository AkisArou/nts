/*---
description: An inherited spread getter controls concat through a base-class return while retaining the actual receiver.
features: [ts-symbol-route-well-known, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-unknown, ts-class, ts-class-fields, ts-inheritance, ts-accessors, ts-this, ts-index-signatures, ts-numbers, ts-symbols]
---*/
// Symbol.isConcatSpreadable: Base and child indexed objects return as BatchBase; node reads their inherited spread getter once and preserves holes or object identity.
const log: unknown[] = [];
class BatchBase {
  length: number; spread: boolean; [index: number]: number;
  constructor(values: number[], spread: boolean) {
    this.length = values.length; this.spread = spread; for (let i = 0; i < values.length; i++) if (i in values) this[i] = values[i];
  }
  get [Symbol.isConcatSpreadable](): boolean { log.push(this, this.spread); return this.spread; }
}
class BatchChild extends BatchBase { child: boolean = true; }
function make(values: number[], spread: boolean, child: boolean): BatchBase { return child ? new BatchChild(values, spread) : new BatchBase(values, spread); }
function concatenate(target: BatchBase): unknown[] { const prefix: unknown[] = ["start"]; return prefix.concat(target); }
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

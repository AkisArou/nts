/*---
description: "Two interface method calls return successive bigints into one template."
features: [ts-template-routes, ts-template-route-substitutions, ts-strings, ts-conversions, ts-arrays, ts-functions, ts-typeof-operator, ts-unknown, ts-interfaces, ts-class, ts-class-fields, ts-this, ts-bigint, ts-tuples, ts-numbers, ts-iteration, ts-template-literals]
---*/
// A typed method advances a bigint field after each read; node converts the old value then its successor and leaves the second successor in the shared object.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
interface Sequence { next(): bigint; }
const rows: [bigint, string][] = [[0n, "0/1"], [-1n, "-1/0"], [9007199254740993n, "9007199254740993/9007199254740994"], [18446744073709551616n, "18446744073709551616/18446744073709551617"]];
const log: unknown[] = [];
class BigSequence implements Sequence {
  value: bigint;
  constructor(value: bigint) { this.value = value; }
  next(): bigint { const value = this.value; this.value += 1n; log.push(value); return value; }
}
function render(source: Sequence): string { return `${source.next()}/${source.next()}`; }
for (const row of rows) {
  log.length = 0; const source = new BigSequence(row[0]), view: Sequence = source;
  assert.sameValue(render(view), row[1]); same(source.value, row[0] + 2n);
  assert.compareArray(log, [row[0], row[0] + 1n]); same(view, source);
}

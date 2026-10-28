/*---
description: A method-sink write makes nominal numeric array elements compare as strings in sort.
features: [ts-unsound-bivariance, ts-arrays, ts-typeof-operator, ts-conversions, ts-functions, ts-expressions, ts-objects]
---*/
// TypeScript makes method parameters bivariant, so a wider sink caller can
// write strings into numeric slots. Node sorts the actual strings lexically.
function inject(sink: { put(left: unknown, right: unknown): void }): void {
  sink.put("2", "10");
}
const values: number[] = [0, 0];
inject({
  put(left: number, right: number): void {
    values[0] = left;
    values[1] = right;
  }
});
let comparisons = 0;
values.sort((left: number, right: number) => {
  comparisons++;
  assert.sameValue(typeof left, "string");
  assert.sameValue(typeof right, "string");
  return left < right ? -1 : left > right ? 1 : 0;
});
assert.sameValue(comparisons > 0, true);
assert.sameValue(JSON.stringify(values), '["10","2"]');
assert.sameValue(String(values[0] + 1), "101");

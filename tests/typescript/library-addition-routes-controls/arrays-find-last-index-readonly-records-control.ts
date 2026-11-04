/*---
description: "Control for arrays-find-last-index-readonly-records; findLastIndex checks reference identity through a readonly array with complete callback indices."
features: [ts-library-addition-routes, ts-library-addition-route-arrays, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-strings, ts-expressions, ts-interfaces, ts-readonly, ts-tuples, ts-destructuring, ts-typeof-operator, ts-template-literals, ts-closures, ts-objects]
---*/
// findLastIndex crosses a readonly record-array parameter and a logged predicate; node returns the last identity match or -1 and leaves every receiver slot unchanged. The control uses older indexed loops in place of the new method.
const log: string[] = [];
interface Item { id: string; }
function check(source: readonly Item[], sought: Item, expected: number, expectedLog: string[]): void {
  const before = source.slice(), keys = Object.keys(source); log.length = 0;
  function predicate(value: Item, index: number, array: readonly Item[]): boolean {
    log.push(`${index}:${value.id}:${array === source}`);
    return value === sought;
  }
  let result = -1;
  for (let index = source.length - 1; index >= 0; index--) { if (predicate(source[index], index, source)) { result = index; break; } }
  assert.compareArray(log, expectedLog);
  assert.sameValue(result, expected); assert.sameValue(typeof result, "number");
  assert.compareArray(source, before); assert.sameValue(source.length, before.length); assert.compareArray(Object.keys(source), keys);
}
for (const suffix of ["one", "two"]) {
  const a: Item = { id: "a:" + suffix }, b: Item = { id: "b:" + suffix }, different: Item = { id: a.id };
  const all = [`2:${a.id}:true`, `1:${b.id}:true`, `0:${a.id}:true`];
  const rows: [readonly Item[], Item, number, string[]][] = [[[a, b, a], a, 2, all.slice(0, 1)], [[a, b, a], b, 1, all.slice(0, 2)], [[a, b, a], different, -1, all], [[], a, -1, []], [[a], a, 0, [`0:${a.id}:true`]]];
  for (const [source, sought, expected, expectedLog] of rows) check(source, sought, expected, expectedLog);
}

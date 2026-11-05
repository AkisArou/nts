/*---
description: "Flat without a depth removes one array level and keeps nested arrays and object references through two interface implementations supplying nested arrays. (control)"
features: [ts-array-method-routes, ts-array-method-route-copies, ts-arrays, ts-functions, ts-iteration, ts-class, ts-class-fields, ts-interfaces, ts-readonly, ts-unions, ts-type-aliases, ts-numbers, ts-objects, ts-unknown]
---*/

type LocalFlatValue = number | string | null | undefined | { id: number } | readonly LocalFlatValue[];
function localFlat(items: readonly LocalFlatValue[], depth: number = 1): LocalFlatValue[] {
  const result: LocalFlatValue[] = [];
  function append(values: readonly LocalFlatValue[], level: number): void {
    for (let i = 0; i < values.length; i++) {
      const value = values[i];
      if (level > 0 && typeof value === "object" && value !== null && !("id" in value)) append(value, level - 1);
      else result[result.length] = value;
    }
  }
  append(items, depth !== depth ? 0 : depth === Infinity ? depth : depth - depth % 1);
  return result;
}
// Flat without a depth removes one array level and keeps nested arrays and object references; route: two interface implementations supplying nested arrays.
// Node prints copies-flat-interface-default:ok.
type Nested = number | { id: number } | Nested[];
const first: { id: number } = { id: 1 }, second: { id: number } = { id: 2 }, tail: number[] = [3, 5];
interface FlatSource { read(): readonly Nested[] }
class FirstSource implements FlatSource { read(): readonly Nested[] { return [first, [2, tail], 9]; } }
class SecondSource implements FlatSource {
  items: readonly Nested[];
  constructor(items: readonly Nested[] = [[second], 7]) { this.items = items; }
  read(): readonly Nested[] { return this.items; }
}
const providers: readonly FlatSource[] = [new FirstSource(), new SecondSource(), new SecondSource([]), new SecondSource([second])];
const expected: readonly (readonly unknown[])[] = [[first, 2, tail, 9], [second, 7], [], [second]];
for (let i = 0; i < providers.length; i++) {
  const input = providers[i].read(), before: Nested[] = [];
  for (const value of input) before[before.length] = value;
  const result: readonly unknown[] = localFlat(input);
  assert.compareArray(result, expected[i]);
  assert.sameValue(result === input, false);
  assert.compareArray(input, before);
  assert.compareArray(tail, [3, 5]);
}
console.log("copies-flat-interface-default:ok");

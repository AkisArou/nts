/*---
description: "Join distinguishes outer separators from nested commas and returns empty text for empty arrays through two interface implementations supplying arrays."
features: [ts-array-method-routes, ts-array-method-route-copies, ts-arrays, ts-functions, ts-iteration, ts-class, ts-class-fields, ts-interfaces, ts-readonly, ts-tuples, ts-unions, ts-type-aliases, ts-numbers, ts-strings]
---*/

// Join distinguishes outer separators from nested commas and returns empty text for empty arrays; route: two interface implementations supplying arrays.
// Node prints copies-join-interface-empty-nesting:ok.
type JoinValue = number | JoinValue[];
interface JoinSource { read(): readonly JoinValue[] }
class NestedSource implements JoinSource {
  items: JoinValue[];
  constructor(items: JoinValue[]) { this.items = items; }
  read(): readonly JoinValue[] { return this.items; }
}
class EmptySource implements JoinSource { read(): readonly JoinValue[] { return []; } }
const tail: number[] = [3, 4], nested: JoinValue[] = [2, tail];
const rows: readonly [JoinSource, string][] = [[new NestedSource([[], nested, []]), "~2,3,4~"], [new NestedSource([[]]), ""], [new EmptySource(), ""]];
for (const [provider, expected] of rows) {
  const input = provider.read(), before: JoinValue[] = [];
  for (const value of input) before[before.length] = value;
  assert.sameValue(input.join("~"), expected);
  assert.compareArray(input, before);
}
assert.compareArray(nested, [2, tail]);
assert.compareArray(tail, [3, 4]);
console.log("copies-join-interface-empty-nesting:ok");

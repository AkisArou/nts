/*---
description: "With replaces the last element by the supplied object while preserving other references and the original source through two interface implementations supplying readonly arrays."
features: [ts-array-method-routes, ts-array-method-route-copies, ts-arrays, ts-functions, ts-iteration, ts-class, ts-class-fields, ts-interfaces, ts-readonly, ts-objects, ts-type-aliases, ts-numbers]
---*/

// With replaces the last element by the supplied object while preserving other references and the original source; route: two interface implementations supplying readonly arrays.
// Node prints copies-with-interface-reference-replacement:ok.
type Token = { id: number };
const first: Token = { id: 1 }, second: Token = { id: 2 }, third: Token = { id: 3 }, replacement: Token = { id: 9 };
interface Provider { read(): readonly Token[] }
class LongProvider implements Provider { read(): readonly Token[] { return [first, second, third]; } }
class ShortProvider implements Provider {
  items: readonly Token[];
  constructor(items: readonly Token[] = [third, first]) { this.items = items; }
  read(): readonly Token[] { return this.items; }
}
const providers: readonly Provider[] = [new LongProvider(), new ShortProvider(), new ShortProvider([first])];
const expected: readonly (readonly Token[])[] = [[first, second, replacement], [third, replacement], [replacement]];
for (let i = 0; i < providers.length; i++) {
  const input = providers[i].read(), before: Token[] = [];
  for (const value of input) before[before.length] = value;
  const result = input.with(-1, replacement);
  assert.compareArray(result, expected[i]);
  assert.sameValue(result === input, false);
  assert.sameValue(result[result.length - 1] === replacement, true);
  assert.compareArray(input, before);
}
console.log("copies-with-interface-reference-replacement:ok");

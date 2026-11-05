/*---
description: "Fill stores the one supplied object in every slot and returns the original empty single or longer array through a private array field. (control)"
features: [ts-array-method-routes, ts-array-method-route-writes, ts-arrays, ts-functions, ts-iteration, ts-class, ts-class-fields, ts-private-fields, ts-readonly, ts-tuples, ts-type-aliases, ts-numbers, ts-objects]
---*/

function localIndex(value: number, length: number): number {
  let index = value !== value ? 0 : value === Infinity ? length : value === -Infinity ? 0 : value - value % 1;
  if (index < 0) index += length;
  return index < 0 ? 0 : index > length ? length : index;
}
function localFill<T>(items: T[], value: T, start: number = 0, end: number = items.length): T[] {
  const first = localIndex(start, items.length), last = localIndex(end, items.length);
  for (let i = first; i < last; i++) items[i] = value;
  return items;
}
// Fill stores the one supplied object in every slot and returns the original empty single or longer array; route: a private array field.
// Node prints writes-fill-private-field-shared-object:ok.
type Token = { id: number };
const first: Token = { id: 1 }, second: Token = { id: 2 }, third: Token = { id: 3 }, replacement: Token = { id: 9 };
class FillBox {
  #items: Token[];
  constructor(items: Token[]) { this.#items = items; }
  write(value: Token): Token[] { return localFill(this.#items, value); }
  read(): readonly Token[] { return this.#items; }
}
const rows: readonly [Token[], readonly Token[]][] = [[[], []], [[first], [replacement]], [[first, second, third], [replacement, replacement, replacement]]];
for (const [input, expected] of rows) {
  const box: FillBox = new FillBox(input), result = box.write(replacement);
  assert.sameValue(result === input, true);
  assert.sameValue(box.read() === input, true);
  assert.compareArray(box.read(), expected);
  replacement.id = 33;
  for (const value of box.read()) {
    assert.sameValue(value === replacement, true);
    assert.sameValue(value.id, 33);
  }
}
console.log("writes-fill-private-field-shared-object:ok");

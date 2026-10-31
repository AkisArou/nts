/*---
description: Yielding an object does not consume the generator reference needed after resumption.
features: [ts-lifetime-move, ts-route-yield, ts-functions, ts-iteration, ts-arrays, ts-strings, ts-objects, ts-generators, ts-tuples]
---*/
// Fact: a last-use handoff moves its count (docs/foundations/memory.md, "Where nts stands").
// Route: the caller drops the yielded value; Node resumes with the original object and only then makes aliases.
type Cell = { id: number; text: string };
function make(id: number): Cell { return { id, text: "cell/" + id }; }
function consume(item: Cell): number {
  const destination: Cell[] = [];
  destination.push(item);
  const checksum = destination[0].id + destination[0].text.length;
  destination.length = 0;
  return checksum;
}
function churn(seed: number): void {
  const rows: Cell[] = [];
  for (let i = 0; i < 24; i++) rows.push(make(seed + 1000 + i));
  let sum = 0;
  for (const row of rows) sum += row.id + row.text.length;
  assert.sameValue(sum, 24 * (seed + 1000) + 492);
}
function check(value: Cell, same: Cell, n: number): void {
  assert.sameValue(value === same, true);
  assert.sameValue(value.id, n);
  assert.sameValue(value.text, "cell/" + n);
  assert.sameValue(value.text.length, ("cell/" + n).length);
}
function* read(n: number): Generator<Cell, [Cell, Cell], unknown> {
  const item = make(n);
  yield item;
  return [item, item];
}
for (let n = 0; n < 256; n++) {
  const iterator = read(n);
  let result: IteratorResult<Cell, [Cell, Cell]> | null = iterator.next();
  if (result.done) throw new Error("missing yield");
  const expected = result.value.id + result.value.text.length;
  assert.sameValue(consume(result.value), expected);
  result = null;
  churn(n);
  const done = iterator.next();
  if (!done.done) throw new Error("not complete");
  check(done.value[0], done.value[1], n);
}

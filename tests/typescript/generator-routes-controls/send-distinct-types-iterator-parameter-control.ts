/*---
description: An Iterator parameter preserves numeric yields, string sends and a distinct typed receipt returned exactly once.
features: [ts-generator-route-sending-completion, ts-generators, ts-iteration, ts-arrays, ts-interfaces, ts-function-types, ts-null-undefined, ts-strings, ts-numbers]
---*/
// Explicit state-number control; An Iterator<number, Receipt | undefined, string | undefined> parameter carries generator objects; node separates all three protocol types.
interface Receipt { tag: string; sent: (string | undefined)[]; }
type Step = IteratorResult<number, Receipt | undefined>;
interface Cursor extends IterableIterator<number, Receipt | undefined, string | undefined> { return(value?: Receipt): Step; throw(error?: unknown): Step; }
type Factory = (values: number[], receipt: Receipt) => Cursor;
function check(step: { value: unknown; done?: boolean }, value: unknown, done: boolean, seen: object[]): void {
  assert.sameValue(step.value, value); assert.sameValue(step.done, done); assert.compareArray(Object.keys(step), ["value", "done"]);
  for (const previous of seen) assert.sameValue(step === previous, false);
  seen.push(step);
}
function model(values: number[], receipt: Receipt): Cursor {
  let state = 0, index = 0;
  return { [Symbol.iterator](): Cursor { return this; },
    next(sent?: string): Step { if (state === 2) return { value: undefined, done: true }; if (state === 1) receipt.sent.push(sent); state = 1; if (index < values.length) return { value: values[index++], done: false }; state = 2; return { value: receipt, done: true }; },
    return(value?: Receipt): Step { state = 2; return { value, done: true }; }, throw(error?: unknown): Step { state = 2; throw error; } };
}
function declared(values: number[], receipt: Receipt): Cursor { return model(values, receipt); }
const expression = function (values: number[], receipt: Receipt): Cursor { return model(values, receipt); };
const makers: Factory[] = [declared, expression];
function advance(cursor: Iterator<number, Receipt | undefined, string | undefined>, sent?: string): Step { return cursor.next(sent); }
const rows: number[][] = [[], [7], [-0, NaN, 41]], sends: (string | undefined)[] = [undefined, "", "third"];
for (const make of makers) for (const values of rows) {
  const receipt: Receipt = { tag: "receipt", sent: [] }, seen: object[] = [], cursor = make(values, receipt); let step = advance(cursor, "ignored");
  for (let i = 0; i < values.length; i++) { check(step, values[i], false, seen); step = advance(cursor, sends[i]); }
  check(step, receipt, true, seen); check(advance(cursor, "after completion"), undefined, true, seen); check(advance(cursor), undefined, true, seen);
  assert.sameValue(receipt.tag, "receipt"); assert.compareArray(receipt.sent, sends.slice(0, values.length));
}

/*---
description: "Control for spread-rest-rest-key-snapshot; Rest skips a deleted captured key and ignores a key added while an earlier getter runs."
features: [ts-object-routes, ts-object-route-spread-rest, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-type-aliases, ts-unions, ts-numbers, ts-strings, ts-null-undefined, ts-unknown, ts-typeof-operator, ts-record, ts-accessors, ts-closures, ts-expressions]
---*/
// A typed dictionary early getter changes later presence after the rest-key snapshot; node omits the removed key and never visits the newly added key. The control copies fields explicitly from the fixture key/presence data.
type CopyValue = number | string | boolean | undefined | null | { id: number };
const first = { id: 7 }, second = { id: 7 }, replacement = { id: 99 };
const inputs: CopyValue[] = [-0, NaN, "", "tail", undefined, null, false, first, second];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function order(value: object, keys: string[]): void { assert.compareArray(Object.keys(value), keys); const seen: string[] = []; for (const key in value) seen.push(key); assert.compareArray(seen, keys); }
type CopyRecord = Record<string, CopyValue>;
function inspect(input: CopyValue, add: boolean, remove: boolean): void {
  const log: unknown[] = []; let source: CopyRecord;
  source = { drop: null, get early(): CopyValue { log.push("get.early", input); if (remove) delete source.late; if (add) source.added = replacement; return input; },
    late: input, get tail(): CopyValue { log.push("get.tail", first); return first; } };
  const chosen = source.drop, copy: CopyRecord = {}; copy.early = source.early; if (!remove) copy.late = source.late; copy.tail = source.tail;
  const keys = ["early"]; if (!remove) keys.push("late"); keys.push("tail");
  const sourceKeys = ["drop", "early"]; if (!remove) sourceKeys.push("late"); sourceKeys.push("tail"); if (add) sourceKeys.push("added");
  order(copy, keys); order(source, sourceKeys); same(chosen, null); same(Object.is(copy, source), false); same(copy.early, input); same(copy.tail, first);
  same(copy.late, remove ? undefined : input); same(Object.hasOwn(copy, "late"), !remove); same(Object.hasOwn(copy, "added"), false); same(copy.added, undefined);
  same(Object.hasOwn(source, "added"), add); same(source.added, add ? replacement : undefined); assert.compareArray(log, ["get.early", input, "get.tail", first]);
}
for (const input of inputs) for (const add of [false, true]) for (const remove of [false, true]) inspect(input, add, remove);

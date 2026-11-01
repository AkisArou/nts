/*---
description: "Control for spread-rest-rest-excluded-getter-mutation; An excluded getter changes the own-key set before object rest captures its keys."
features: [ts-object-routes, ts-object-route-spread-rest, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-type-aliases, ts-unions, ts-numbers, ts-strings, ts-null-undefined, ts-unknown, ts-typeof-operator, ts-record, ts-accessors, ts-closures, ts-expressions]
---*/
// A typed dictionary drop getter inserts an integer key or deletes an optional string key; node copies the updated own-key set in order without reading drop twice. The control copies fields explicitly from the fixture key/presence data.
type CopyValue = number | string | boolean | undefined | null | { id: number };
const first = { id: 7 }, second = { id: 7 }, replacement = { id: 99 };
const inputs: CopyValue[] = [-0, NaN, "", "tail", undefined, null, false, first, second];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function order(value: object, keys: string[]): void { assert.compareArray(Object.keys(value), keys); const seen: string[] = []; for (const key in value) seen.push(key); assert.compareArray(seen, keys); }
type CopyRecord = Record<string, CopyValue>;
function inspect(input: CopyValue, add: boolean, remove: boolean): void {
  const log: unknown[] = []; let source: CopyRecord;
  source = { get drop(): CopyValue { log.push("get.drop", input); if (add) source["3"] = replacement; if (remove) delete source.late; return input; },
    "2": first, late: input, get tail(): CopyValue { log.push("get.tail", null); return null; } };
  const chosen = source.drop, copy: CopyRecord = {}; copy["2"] = source["2"]; if (add) copy["3"] = source["3"]; if (!remove) copy.late = source.late; copy.tail = source.tail;
  const keys = ["2"]; if (add) keys.push("3"); if (!remove) keys.push("late"); keys.push("tail");
  const sourceKeys = ["2"]; if (add) sourceKeys.push("3"); sourceKeys.push("drop"); if (!remove) sourceKeys.push("late"); sourceKeys.push("tail");
  order(copy, keys); order(source, sourceKeys); same(chosen, input); same(Object.is(copy, source), false); same(Object.hasOwn(copy, "drop"), false);
  same(copy["2"], first); same(copy["3"], add ? replacement : undefined); same(copy.late, remove ? undefined : input); same(copy.tail, null);
  same(Object.hasOwn(copy, "3"), add); same(Object.hasOwn(copy, "late"), !remove); assert.compareArray(log, ["get.drop", input, "get.tail", null]);
}
for (const input of inputs) for (const add of [false, true]) for (const remove of [false, true]) inspect(input, add, remove);

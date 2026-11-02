/*---
description: Explicit string-key record control for Assigning multiple typed records updates shared symbol keys without moving their positions.
features: [ts-symbol-route-copying, ts-symbols, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-record, ts-unknown, ts-computed-keys, ts-spread]
---*/
// A Record source array crosses a parameter; node applies sources left to right, preserves each symbol identity and ignores a later hidden replacement.
type Value = number | string | undefined;
interface Table { names: string[]; symbols: string[]; data: Record<string, Value>; shown: Record<string, boolean>; inherited: Record<string, Value>; }
const first = "@first", second = "@second", hidden = "@hidden", tokenList: string[] = [first, second, hidden];
function blank(): Table { return { names: [], symbols: [], data: {}, shown: {}, inherited: {} }; }
function put(table: Table, key: string, value: Value, show: boolean = true): void { const list = tokenList.includes(key) ? table.symbols : table.names; if (!list.includes(key)) list.push(key); table.data[key] = value; table.shown[key] = show; }
function ownKeys(table: Table): string[] { const integers: string[] = [], names: string[] = []; for (const key of table.names) { if (String(Number(key)) === key && Number.isInteger(Number(key)) && Number(key) >= 0 && Number(key) < 4294967295) { let at = 0; while (at < integers.length && Number(integers[at]) < Number(key)) at++; integers.splice(at, 0, key); } else names.push(key); } return integers.concat(names, table.symbols); }
function tokens(table: Table): string[] { return table.symbols.slice(); }
function read(table: Table, key: string): Value { return ownKeys(table).includes(key) ? table.data[key] : table.inherited[key]; }
function write(table: Table, key: string, value: Value): void { put(table, key, value, ownKeys(table).includes(key) ? table.shown[key] : true); }
function copyFields(target: Table, sources: Table[]): Table { for (const source of sources) for (const key of ownKeys(source)) if (source.shown[key]) put(target, key, source.data[key]); return target; }
function copy(sources: Table[]): Table { return copyFields(blank(), sources); }
for (const initial of [-0, NaN, undefined, 7]) for (const count of [0, 1, 2]) {
  const left: Table = blank(), right: Table = blank();
  put(left, first, initial); put(left, "tail", 8); put(left, second, 13); put(left, "10", 10);
  put(right, second, 21); put(right, "2", 2); put(right, first, 34, false); put(right, hidden, 55);
  const sources: Table[] = count === 0 ? [] : count === 1 ? [left] : [left, right], result = copy(sources);
  assert.compareArray(ownKeys(result), count === 0 ? [] : count === 1 ? ["10", "tail", first, second] : ["2", "10", "tail", first, second, hidden]);
  assert.compareArray(tokens(result), count === 0 ? [] : count === 1 ? [first, second] : [first, second, hidden]);
  assert.compareArray([read(result, first), read(result, second), read(result, hidden)], count === 0 ? [undefined, undefined, undefined] : [initial, count === 1 ? 13 : 21, count === 1 ? undefined : 55]);
  if (count > 0) { assert.sameValue(read(result, "10"), 10); assert.sameValue(read(result, "tail"), 8); write(result, first, 89); assert.sameValue(read(left, first), initial); write(left, second, 144); assert.sameValue(read(left, second), 144); assert.sameValue(read(result, second), count === 1 ? 13 : 21); assert.sameValue(read(result, first), 89); }
  if (count === 2) { assert.sameValue(read(result, "2"), 2); write(right, hidden, 233); assert.sameValue(read(right, hidden), 233); assert.sameValue(read(result, hidden), 55); }
  assert.compareArray(ownKeys(left), ["10", "tail", first, second]); assert.compareArray(ownKeys(right), ["2", second, first, hidden]);
}

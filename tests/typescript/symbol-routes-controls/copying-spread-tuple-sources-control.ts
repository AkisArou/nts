/*---
description: Explicit string-key record control for Two typed tuple sources preserve symbol insertion order while a later spread replaces the same identity.
features: [ts-symbol-route-copying, ts-symbols, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-record, ts-unknown, ts-computed-keys, ts-spread, ts-tuples, ts-interfaces]
---*/
// A tuple field carries two symbol-bearing records; node spreads both, keeps the first insertion position and copies only enumerable later keys.
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
interface PairHolder { pair: [Table, Table]; }
function copy(holder: PairHolder): Table { return copyFields(blank(), holder.pair); }
for (const initial of [-0, NaN, undefined, 7]) for (const show of [false, true]) {
  const left = blank(), right = blank(); put(left, second, 5); put(left, first, initial); put(left, "tail", 8);
  put(right, first, 13, show); put(right, "2", 2); put(right, hidden, 21); put(right, second, 34);
  const holder: PairHolder = { pair: [left, right] }, result = copy(holder);
  assert.compareArray(ownKeys(result), ["2", "tail", second, first, hidden]); assert.compareArray(tokens(result), [second, first, hidden]);
  assert.compareArray([read(result, "2"), read(result, "tail"), read(result, second), read(result, first), read(result, hidden)], [2, 8, 34, show ? 13 : initial, 21]);
  assert.compareArray(ownKeys(left), ["tail", second, first]); assert.compareArray(ownKeys(right), ["2", first, hidden, second]);
  write(result, first, 55); assert.sameValue(read(left, first), initial); assert.sameValue(read(right, first), 13); write(right, second, 89); assert.sameValue(read(right, second), 89); assert.sameValue(read(result, second), 34); assert.sameValue(read(result, first), 55);
}

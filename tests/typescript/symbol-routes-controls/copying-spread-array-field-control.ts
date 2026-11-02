/*---
description: Explicit string-key record control for Spread from a declared array field copies indices and enumerable symbol keys but skips length and hidden symbols.
features: [ts-symbol-route-copying, ts-symbols, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-record, ts-unknown, ts-computed-keys, ts-spread, ts-interfaces]
---*/
// A typed array field carries sparse arrays and symbol properties; node copies present indices and enumerable symbols to a plain independent result.
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
type Tagged = Table;
interface Holder { items: Tagged; }
function items(size: number, value: Value): Tagged { const result = blank(); put(result, "length", size, false); if (size > 0) put(result, String(size - 1), 8); put(result, first, value); put(result, second, 13, false); return result; }
function copy(holder: Holder): Table { return copyFields(blank(), [holder.items]); }
for (const initial of [-0, NaN, undefined, 7]) for (const size of [0, 1, 3]) {
  const holder: Holder = { items: items(size, initial) }, result = copy(holder), names = size === 0 ? [] : [String(size - 1)];
  assert.sameValue(result === holder.items, false); assert.compareArray(ownKeys(result), [...names, first]); assert.compareArray(tokens(result), [first]);
  assert.compareArray(ownKeys(holder.items), [...names, "length", first, second]); assert.compareArray(tokens(holder.items), [first, second]);
  assert.sameValue(read(result, "length"), undefined); assert.sameValue(read(holder.items, "length"), size); assert.sameValue(read(result, first), initial); assert.sameValue(read(result, second), undefined);
  if (size > 0) assert.sameValue(read(result, String(size - 1)), 8); if (size > 1) assert.sameValue(read(result, "0"), undefined);
  write(result, first, 21); assert.sameValue(read(holder.items, first), initial); write(holder.items, first, 34); assert.sameValue(read(result, first), 21); assert.sameValue(read(holder.items, first), 34);
}

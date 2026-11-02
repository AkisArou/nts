/*---
description: Explicit string-key record control for Spread through a declared class field copies own symbol fields and excludes an inherited symbol.
features: [ts-symbol-route-copying, ts-symbols, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-record, ts-unknown, ts-computed-keys, ts-spread, ts-class, ts-class-fields]
---*/
// A holder field carries class instances with own and inherited symbol keys; node copies only own enumerable fields and later writes remain separate.
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
type Packet = Table;
class Holder { source: Packet; constructor(source: Packet) { this.source = source; } }
function copy(holder: Holder): Table { return copyFields(blank(), [holder.source]); }
function packet(value: Value): Packet { const result = blank(); put(result, "label", 8); put(result, first, value); put(result, second, 13); result.inherited[hidden] = 99; return result; }
for (const initial of [-0, NaN, undefined, 7]) {
  const holder: Holder = new Holder(packet(initial)), result = copy(holder);
  assert.sameValue(Object.is(result, holder.source), false); assert.compareArray(ownKeys(result), ["label", first, second]); assert.compareArray(tokens(result), [first, second]);
  assert.compareArray(ownKeys(holder.source), ["label", first, second]); assert.compareArray(tokens(holder.source), [first, second]);
  assert.compareArray([read(result, "label"), read(result, first), read(result, second), read(result, hidden)], [8, initial, 13, undefined]); assert.sameValue(read(holder.source, hidden), 99);
  write(result, first, 21); assert.sameValue(read(holder.source, first), initial); write(holder.source, second, 34); assert.sameValue(read(result, second), 13);
  assert.sameValue(read(result, first), 21); assert.sameValue(read(holder.source, second), 34);
}

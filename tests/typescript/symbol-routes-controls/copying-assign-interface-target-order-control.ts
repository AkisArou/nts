/*---
description: Explicit string-key record control for Object.assign preserves existing symbol positions on a typed target while replacing values by identity.
features: [ts-symbol-route-copying, ts-symbols, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-record, ts-unknown, ts-computed-keys, ts-spread, ts-interfaces]
---*/
// An interface target already owns one symbol; node assigns a typed source, retaining target key positions and keeping a distinct same-description key.
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
interface Target extends Table {}
function targetOf(): Target { const result = blank(); put(result, "start", 1); put(result, first, 3); return result; }
function copy(source: Table, target: Target): Target { return copyFields(target, [source]); }
for (const initial of [-0, NaN, undefined, 7]) for (const show of [false, true]) {
  const source: Table = blank(), target: Target = targetOf();
  put(source, second, 5); put(source, first, initial); put(source, "tail", 8); put(source, "2", 2); put(source, hidden, 99, show);
  const result = copy(source, target), expected = show ? [first, second, hidden] : [first, second];
  assert.sameValue(result, target); assert.compareArray(tokens(result), expected); assert.compareArray(ownKeys(result), ["2", "start", "tail", ...expected]);
  assert.compareArray(tokens(source), [second, first, hidden]); assert.compareArray(ownKeys(source), ["2", "tail", second, first, hidden]);
  assert.compareArray([read(result, "2"), read(result, "start"), read(result, "tail"), read(result, first), read(result, second), read(result, hidden)], [2, 1, 8, initial, 5, show ? 99 : undefined]);
  write(result, first, 21); assert.sameValue(read(source, first), initial); write(source, second, 34); assert.sameValue(read(result, second), 5);
  assert.sameValue(read(result, first), 21); assert.sameValue(read(source, second), 34);
}

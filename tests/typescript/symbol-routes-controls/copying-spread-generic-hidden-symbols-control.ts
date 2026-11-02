/*---
description: Explicit string-key record control for Generic spread copies enumerable symbol identities and omits hidden symbols without linking later writes.
features: [ts-symbol-route-copying, ts-symbols, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-record, ts-unknown, ts-computed-keys, ts-spread, ts-generics]
---*/
// A generic typed record carries two same-description symbol keys and a hidden symbol; node copies only enumerable own keys into independent storage.
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
function copy<T extends Table>(source: T): Table { return copyFields(blank(), [source]); }
for (const initial of [-0, NaN, undefined, 7]) for (const mode of ["empty", "visible", "hidden"]) {
  const source: Table = blank();
  if (mode !== "empty") { put(source, second, initial); put(source, "tail", 8); put(source, first, 13); put(source, "10", 10); put(source, "2", 2); put(source, hidden, 99, mode === "visible"); }
  const copyValue = copy(source), expected = mode === "empty" ? [] : mode === "visible" ? [second, first, hidden] : [second, first];
  assert.sameValue(copyValue === source, false); assert.compareArray(tokens(copyValue), expected);
  assert.compareArray(ownKeys(copyValue), mode === "empty" ? [] : ["2", "10", "tail", ...expected]);
  assert.compareArray(tokens(source), mode === "empty" ? [] : [second, first, hidden]);
  assert.compareArray(ownKeys(source), mode === "empty" ? [] : ["2", "10", "tail", second, first, hidden]);
  assert.sameValue(read(copyValue, second), mode === "empty" ? undefined : initial); assert.sameValue(read(copyValue, first), mode === "empty" ? undefined : 13);
  assert.sameValue(read(copyValue, hidden), mode === "visible" ? 99 : undefined);
  if (mode !== "empty") { assert.compareArray([read(copyValue, "2"), read(copyValue, "10"), read(copyValue, "tail")], [2, 10, 8]); write(copyValue, second, 21); assert.sameValue(read(source, second), initial); write(source, first, 34); assert.sameValue(read(copyValue, first), 13); assert.sameValue(read(copyValue, second), 21); assert.sameValue(read(source, first), 34); }
}

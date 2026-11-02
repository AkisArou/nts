/*---
description: Explicit string-key record control for Assigning a narrowed union source copies only the selected arm symbol and preserves its identity.
features: [ts-symbol-route-copying, ts-symbols, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-record, ts-unknown, ts-computed-keys, ts-spread, ts-unions, ts-literal-types]
---*/
// A discriminated union returns its selected typed source to assign; node copies the selected own symbol while keeping writes independent.
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
type Choice = { kind: "left"; source: Table } | { kind: "right"; source: Table };
function sourceOf(choice: Choice): Table { if (choice.kind === "left") return copyFields(blank(), [choice.source]); return copyFields(blank(), [choice.source]); }
function choose(value: Value, kind: "left" | "right"): Choice { const source = blank(); put(source, "label", 8); put(source, kind === "left" ? first : second, value); return kind === "left" ? { kind, source } : { kind, source }; }
for (const initial of [-0, NaN, undefined, 7]) for (const kind of ["left", "right"]) {
  if (kind !== "left" && kind !== "right") throw new Error("kind");
  const choice: Choice = choose(initial, kind), result = sourceOf(choice), selected = kind === "left" ? first : second, other = kind === "left" ? second : first;
  assert.sameValue(result === choice.source, false); assert.compareArray(ownKeys(result), ["label", selected]); assert.compareArray(tokens(result), [selected]);
  assert.compareArray(ownKeys(choice.source), ["label", selected]); assert.compareArray(tokens(choice.source), [selected]);
  assert.sameValue(read(result, "label"), 8); assert.sameValue(read(result, selected), initial); assert.sameValue(read(result, other), undefined);
  write(result, selected, 21); assert.sameValue(read(choice.source, selected), initial); write(choice.source, selected, 34); assert.sameValue(read(result, selected), 21); assert.sameValue(read(choice.source, selected), 34);
}

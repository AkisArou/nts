/*---
description: Assigning a narrowed union source copies only the selected arm symbol and preserves its identity.
features: [ts-symbol-route-copying, ts-symbols, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-record, ts-unknown, ts-computed-keys, ts-spread, ts-unions, ts-literal-types]
---*/
// A discriminated union returns its selected typed source to assign; node copies the selected own symbol while keeping writes independent.
type Value = number | string | undefined;
type Table = Record<PropertyKey, Value>;
const first: unique symbol = Symbol("same"), second: unique symbol = Symbol("same"), hidden: unique symbol = Symbol("hidden");
function blank(): Table { return {}; }
function put(table: object, key: PropertyKey, value: Value, show: boolean = true): void { Object.defineProperty(table, key, { value, writable: true, enumerable: show, configurable: true }); }
function ownKeys(table: object): PropertyKey[] { return Reflect.ownKeys(table); }
function tokens(table: object): symbol[] { return Object.getOwnPropertySymbols(table); }
function read(table: object, key: PropertyKey): unknown { return Reflect.get(table, key); }
function write(table: object, key: PropertyKey, value: Value): void { assert.sameValue(Reflect.set(table, key, value), true); }
type Choice = { kind: "left"; source: { label: Value; [first]: Value } } | { kind: "right"; source: { label: Value; [second]: Value } };
function sourceOf(choice: Choice): Table { if (choice.kind === "left") return Object.assign({}, choice.source); return Object.assign({}, choice.source); }
function choose(value: Value, kind: "left" | "right"): Choice { return kind === "left" ? { kind, source: { label: 8, [first]: value } } : { kind, source: { label: 8, [second]: value } }; }
for (const initial of [-0, NaN, undefined, 7]) for (const kind of ["left", "right"]) {
  if (kind !== "left" && kind !== "right") throw new Error("kind");
  const choice: Choice = choose(initial, kind), result = sourceOf(choice), selected = kind === "left" ? first : second, other = kind === "left" ? second : first;
  assert.sameValue(result === choice.source, false); assert.compareArray(ownKeys(result), ["label", selected]); assert.compareArray(tokens(result), [selected]);
  assert.compareArray(ownKeys(choice.source), ["label", selected]); assert.compareArray(tokens(choice.source), [selected]);
  assert.sameValue(read(result, "label"), 8); assert.sameValue(read(result, selected), initial); assert.sameValue(read(result, other), undefined);
  write(result, selected, 21); assert.sameValue(read(choice.source, selected), initial); write(choice.source, selected, 34); assert.sameValue(read(result, selected), 21); assert.sameValue(read(choice.source, selected), 34);
}

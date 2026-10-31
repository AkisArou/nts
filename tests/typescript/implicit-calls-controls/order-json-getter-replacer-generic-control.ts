/*---
description: Control for order-json-getter-replacer-generic; root replacement, the external getter helper, toJSON and property replacement are explicit.
features: [ts-implicit-order, ts-accessors, ts-class, ts-class-fields, ts-interfaces, ts-generics, ts-generic-constraints, ts-objects, ts-functions, ts-unknown]
---*/
// Control: ../implicit-calls/order-json-getter-replacer-generic.ts; root replacement, the external getter helper, toJSON and property replacement are explicit.
interface JsonValue { toJSON(key: string): string; }
interface Holder { readonly item: JsonValue; }
const log: string[] = [];
let state = 0, expectedHolder: object = {};
class Payload implements JsonValue {
  value: number;
  constructor(value: number) { this.value = value; }
  toJSON(key: string): string { state += 10; log.push(`toJSON:${key}:${this.value}:${state}`); return `item:${this.value}`; }
}
function replacer(key: string, value: unknown): unknown {
  if (key === "") assert.sameValue(value, expectedHolder);
  state += 100; log.push(`replacer:${key}:${typeof value === "string" ? value : typeof value}:${state}`);
  return typeof value === "string" ? value + "!" : value;
}
function serialize<T extends Holder>(holder: T, readItem: () => JsonValue): string | undefined {
  replacer("", holder); const converted = readItem().toJSON("item");
  return JSON.stringify({ item: replacer("item", converted) });
}
for (const n of [-2, 0, 3]) {
  log.length = 0; state = 0;
  const payload = new Payload(n);
  const readItem = (): JsonValue => { state++; log.push(`get:${n}:${state}`); return payload; };
  const holder: Holder = { get item(): JsonValue { return readItem(); } };
  expectedHolder = holder;
  const result = serialize(holder, readItem);
  assert.sameValue(result, `{"item":"item:${n}!"}`);
  assert.sameValue(state, 211);
  assert.compareArray(log, ["replacer::object:100", `get:${n}:101`, `toJSON:item:${n}:111`, `replacer:item:item:${n}:211`]);
}

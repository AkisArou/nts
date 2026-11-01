/*---
description: An interface containing an array of records preserves each parsed element, its fields and insertion order.
features: [ts-json-routes, ts-json-shapes, ts-functions, ts-iteration, ts-unknown, ts-narrowing, ts-typeof-operator, ts-interfaces, ts-objects, ts-arrays, ts-numbers, ts-strings, ts-tuples]
---*/
// Parse matching record arrays into an interface; node preserves every array position, record value, runtime kind and key order.
interface JsonRecordList { items: { amount: number; label: string }[]; }
function check(text: string, first: number, second: number): void {
  const value: JsonRecordList = JSON.parse(text);
  assert.sameValue(typeof value, "object");
  if (typeof value !== "object" || value === null || !("items" in value) || !Array.isArray(value.items)) throw new Error("items");
  assert.compareArray(Object.keys(value), ["items"]); assert.sameValue(typeof value.items, "object");
  const items: unknown[] = value.items;
  assert.sameValue(items.length, 2); assert.compareArray(Object.keys(items), ["0", "1"]);
  const expected: number[] = [first, second]; const labels: string[] = ["first", "second"];
  for (let i = 0; i < items.length; i++) {
    const item: unknown = items[i]; assert.sameValue(typeof item, "object");
    if (typeof item !== "object" || item === null || !("amount" in item) || !("label" in item)) throw new Error("item");
    assert.compareArray(Object.keys(item), ["label", "amount"]);
    assert.sameValue(typeof item.amount, "number"); assert.sameValue(Object.is(item.amount, expected[i]), true);
    assert.sameValue(typeof item.label, "string"); assert.sameValue(item.label, labels[i]);
  }
}
const inputs: [string, number, number][] = [
  ['{"items":[{"label":"first","amount":-0},{"label":"second","amount":1.5}]}', -0, 1.5],
  ['{"items":[{"label":"first","amount":2e3},{"label":"second","amount":-2.5e-2}]}', 2000, -0.025],
  ['{"items":[{"label":"first","amount":9007199254740993},{"label":"second","amount":-9007199254740993}]}', 9007199254740992, -9007199254740992],
];
for (const [text, first, second] of inputs) check(text, first, second);

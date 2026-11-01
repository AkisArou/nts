/*---
description: Unknown object and array narrowing preserves contents with every permitted JSON whitespace character at structural token boundaries.
features: [ts-json-routes, ts-json-unknown, ts-unknown, ts-narrowing, ts-functions, ts-iteration, ts-objects, ts-typeof-operator, ts-arrays, ts-numbers, ts-strings, ts-tuples, ts-null-undefined]
---*/
// Parse whitespace around all structural tokens to unknown; node retains number, boolean, null and the spaces inside the string.
function check(token: string, n: number, gap: string): void {
  const text = gap + "{" + gap + '"items"' + gap + ":" + gap + "[" + gap + token + gap + "," + gap + "false" + gap + "," + gap + "null" + gap + "," + gap + '" x "' + gap + "]" + gap + "," + gap + '"ok"' + gap + ":" + gap + "true" + gap + "}" + gap;
  const value: unknown = JSON.parse(text);
  if (typeof value !== "object" || value === null || !("items" in value) || !("ok" in value)) throw new Error("record");
  assert.sameValue(typeof value, "object"); assert.compareArray(Object.keys(value), ["items", "ok"]);
  assert.sameValue(typeof value.ok, "boolean"); assert.sameValue(Object.is(value.ok, true), true);
  assert.sameValue(typeof value.items, "object");
  if (!Array.isArray(value.items)) throw new Error("items");
  const items: unknown[] = value.items, expected: unknown[] = [n, false, null, " x "];
  assert.sameValue(items.length, 4); assert.compareArray(Object.keys(items), ["0", "1", "2", "3"]);
  for (let i = 0; i < 4; i++) {
    assert.sameValue(typeof items[i], typeof expected[i]); assert.sameValue(Object.is(items[i], expected[i]), true);
  }
}
const rows: [string, number][] = [["-0", -0], ["-1.25", -1.25], ["2e+3", 2000]];
for (const [token, n] of rows) for (const gap of [" ", "\t", "\n", "\r", " \t\n\r"]) check(token, n, gap);

/*---
description: An unknown-held array-subclass keeps every own value and alias write after in narrowing to a Record.
features: [ts-record-routes, ts-record-unknown, ts-unknown, ts-narrowing, ts-record, ts-index-signatures, ts-objects, ts-functions, ts-arrays, ts-iteration, ts-typeof-operator, ts-numbers, ts-strings, ts-null-undefined, ts-class, ts-class-fields, ts-inheritance]
---*/
// Carry an Array subclass with numeric and ordinary own fields through unknown and typeof/null and in checks, then an accepted Record annotation; node keeps every ordered value and the write visible through both aliases.
function inspect(value: Record<string, unknown>, expected: unknown[]): void {
  const keys = ["2", "10", "01", "-1", "4294967295", "tail"];
  const fixed = [value["2"], value["10"], value["01"], value["-1"], value["4294967295"], value["tail"]];
  assert.sameValue(Object.is(value.tail, expected[5]), true); assert.sameValue(typeof value.tail, typeof expected[5]);
  const values: unknown[] = Object.values(value), entries: [string, unknown][] = Object.entries(value);
  assert.compareArray(Object.keys(value), keys);
  assert.sameValue(values.length, keys.length); assert.sameValue(entries.length, keys.length);
  for (let i = 0; i < keys.length; i++) {
    assert.sameValue(keys[i] in value, true); assert.compareArray(entries[i], [keys[i], expected[i]]);
    for (const actual of [value[keys[i]], fixed[i], values[i], entries[i][1]]) {
      assert.sameValue(Object.is(actual, expected[i]), true); assert.sameValue(typeof actual, typeof expected[i]);
    }
  }
  const lengthKey: string = "length";
  assert.sameValue(Array.isArray(value), true); assert.sameValue(lengthKey in value, true);
  for (const length of [value[lengthKey], value["length"], value.length]) { assert.sameValue(Object.is(length, 11), true); assert.sameValue(typeof length, "number"); }
  assert.sameValue("missing" in value, false);
}
class RecordList extends Array<unknown> {
  "10": unknown; "2": unknown; "01": unknown;
  "-1": unknown; "4294967295": unknown; tail: unknown;
  constructor(item: unknown, next: unknown) {
    super();
    this["10"] = item; this["2"] = next; this["01"] = undefined;
    this["-1"] = null; this["4294967295"] = true; this.tail = item;
  }
}
const rows: unknown[] = [-0, NaN, 1.25, "text", true, undefined, null, { marker: 1 }, [1, -0]];
for (let i = 0; i < rows.length; i++) {
  const item = rows[i], next = rows[(i + 1) % rows.length];
  const source = new RecordList(item, next);
  const candidate: unknown = source;
  if (typeof candidate !== "object" || candidate === null || !("tail" in candidate)) throw new Error("tail");
  const view: Record<string, unknown> = candidate;
  const expected: unknown[] = [next, item, undefined, null, true, item];
  inspect(view, expected);
  view["2"] = item; expected[0] = item; inspect(view, expected);
  assert.sameValue(Object.is(source[2], item), true); assert.sameValue(typeof source[2], typeof item);
  assert.sameValue(Object.is(view, source), true);
}

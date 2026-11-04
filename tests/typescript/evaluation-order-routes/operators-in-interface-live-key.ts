/*---
description: Membership converts its retained key only after the right operand and its object check.
features: [ts-evaluation-order-routes, ts-evaluation-order-route-operators, ts-interfaces, ts-accessors, ts-functions, ts-objects, ts-record, ts-tuples, ts-arrays, ts-iteration, ts-conversions, ts-to-primitive, ts-expressions, ts-errors, ts-unsound-object-assign]
---*/
// in through an Object.assign-widened string slot; node reads both operands before converting the live key, and checks the right kind first.
const log: string[] = [];
interface Source { readonly key: string; target(): object; }
function present(source: Source): boolean {
  log.push("present");
  return source.key in source.target();
}
const rows: [boolean, string, boolean][] = [[true, "after", true], [true, "absent", false], [false, "after", false]];
for (const row of rows) {
  const key = { text: "before", toString(): string { log.push("key:" + this.text); return this.text; } };
  const keySlot: { value: string } = { value: "" };
  const targetSlot: { value: object } = { value: { after: 7 } };
  Object.assign(keySlot, { value: key });
  if (!row[0]) Object.assign(targetSlot, { value: 0 });
  const source: Source = {
    get key(): string { log.push("get:key"); return keySlot.value; },
    target(): object { log.push("target"); key.text = row[1]; return targetSlot.value; }
  };
  function run(): boolean { log.push("run"); return present(source); }
  log.length = 0;
  if (row[0]) {
    const result = run();
    assert.compareArray(log, ["run", "present", "get:key", "target", "key:" + row[1]]);
    assert.sameValue(result, row[2]);
  } else {
    assert.throws(TypeError, run);
    assert.compareArray(log, ["run", "present", "get:key", "target"]);
  }
  assert.sameValue(key.text, row[1]);
}

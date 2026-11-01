/*---
description: Control for short-assignment-and-reference; A typed computed &&= target is read once and retained across right-side receiver replacement.
features: [ts-control-flow-routes, ts-control-flow-route-short-circuit, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-type-aliases, ts-unions, ts-numbers, ts-strings, ts-null-undefined, ts-unknown, ts-typeof-operator, ts-expressions, ts-tuples, ts-closures, ts-class, ts-class-fields, ts-accessors, ts-computed-keys, ts-literal-types, ts-this]
---*/
// &&= decides on a ShortValue accessor; node logs base, key and get once, skips unselected rhs/set, and writes the original receiver after rhs retargets it. The control spells the tested evaluation out in ordered steps.
type ShortValue = number | string | boolean | null | undefined | { id: number };
const marker = { id: 7 }, replacement = { id: 99 };
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
const rows: [ShortValue, boolean, boolean][] = [[0, false, false], [-0, false, false], [NaN, false, false], ["", false, false], [undefined, false, true], [null, false, true], [false, false, false], [marker, true, false], [7, true, false], ["go", true, false], [true, true, false], [replacement, true, false]];
class ShortSlot {
  value: ShortValue; id: string; log: unknown[];
  constructor(value: ShortValue, id: string, log: unknown[]) { this.value = value; this.id = id; this.log = log; }
  get item(): ShortValue { this.log.push("get", this.id, this.value); return this.value; }
  set item(value: ShortValue) { this.log.push("set", this.id, value); this.value = value; }
}
function inspect(input: ShortValue, truthy: boolean, nullish: boolean): void {
  const log: unknown[] = [], first = new ShortSlot(input, "first", log), other = new ShortSlot(marker, "other", log); let active = first;
  function target(): ShortSlot { log.push("base", active.id); return active; }
  function key(): "item" { log.push("key", active.id); return "item"; }
  function rhs(): ShortValue { log.push("rhs", active.id, input); active = other; log.push("retarget", active.id); return replacement; }
  const base = target(), property = key(); let actual = base[property]; if (actual) { actual = rhs(); base[property] = actual; }
  let expected: ShortValue = input, expectedTarget = first;
  const expectedLog: unknown[] = ["base", "first", "key", "first", "get", "first", input];
  if (truthy) { expected = replacement; expectedTarget = other; expectedLog.push("rhs", "first", input, "retarget", "other", "set", "first", replacement); }
  same(actual, expected); same(first.value, expected); same(other.value, marker); same(active, expectedTarget); assert.compareArray(log, expectedLog);
}
for (const row of rows) inspect(row[0], row[1], row[2]);

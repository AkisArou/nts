/*---
description: Control for storage-variable-instanceof; plain factory records preserve construction, static observations and exact fields.
features: [ts-class-value-route-storage, ts-class, ts-construct-signatures, ts-instanceof, ts-new-target, ts-static, ts-unions, ts-objects, ts-arrays]
---*/
// Control: plain records carry factories and static values; literal instances and tag comparisons retain the same observations.
type StoredValue = number | string | undefined | { id: number };
interface StoredItem { tag: string; value: StoredValue; marker: number; target: string; extra?: string; padding?: number; reserve?: boolean; }
interface StoredTrace { log: unknown[]; made: StoredItem[]; }
interface StoredClass { factory(trace: StoredTrace, value: StoredValue, marker: number): StoredItem; tag: string; label: string; }
const StoreFirst: StoredClass = { tag: "first", label: "first-static", factory(trace, value, marker) {
  const item: StoredItem = { tag: "first", value, marker, target: "StoreFirst" }; trace.made.push(item); trace.log.push("construct", "StoreFirst", trace, value, marker, item.target); return item;
} };
const StoreSecond: StoredClass = { tag: "second", label: "second-static", factory(trace, value, marker) {
  const item: StoredItem = { extra: "layout-second", tag: "second", value, marker, target: "StoreSecond" }; trace.made.push(item); trace.log.push("construct", "StoreSecond", trace, value, marker, item.target); return item;
} };
const StoreThird: StoredClass = { tag: "third", label: "third-static", factory(trace, value, marker) {
  const item: StoredItem = { padding: 3, reserve: true, tag: "third", value, marker, target: "StoreThird" }; trace.made.push(item); trace.log.push("construct", "StoreThird", trace, value, marker, item.target); return item;
} };
const identity = { id: 7 }; const inputs: StoredValue[] = [0, -0, NaN, 0.5, 2147483648, "", "中", undefined, identity];
const choices: [StoredClass, string, string][] = [[StoreFirst, "first", "StoreFirst"], [StoreSecond, "second", "StoreSecond"], [StoreThird, "third", "StoreThird"]];
for (const value of inputs) {
  const trace: StoredTrace = { log: [], made: [] };
  const instances: StoredItem[] = [StoreFirst.factory(trace, value, 1), StoreSecond.factory(trace, value, 2), StoreThird.factory(trace, value, 3)];
  const expected: unknown[] = ["construct", "StoreFirst", trace, value, 1, "StoreFirst", "construct", "StoreSecond", trace, value, 2, "StoreSecond", "construct", "StoreThird", trace, value, 3, "StoreThird"];
  for (let slot = 0; slot < instances.length; slot++) {
    const item = instances[slot], tag = choices[slot][1], className = choices[slot][2];
    assert.sameValue(Object.is(item, trace.made[slot]), true); assert.sameValue(typeof item, "object");
    for (let other = 0; other < instances.length; other++) assert.sameValue(Object.is(item, instances[other]), slot === other);
    const fields: [unknown, unknown][] = [[item.tag, tag], [item.value, value], [item.marker, slot + 1], [item.target, className], [item.extra, tag === "second" ? "layout-second" : undefined], [item.padding, tag === "third" ? 3 : undefined], [item.reserve, tag === "third" ? true : undefined]];
    for (const [actual, wanted] of fields) { assert.sameValue(Object.is(actual, wanted), true); assert.sameValue(typeof actual, typeof wanted); }
    assert.compareArray(Object.keys(item), tag === "first" ? ["tag", "value", "marker", "target"] : tag === "second" ? ["extra", "tag", "value", "marker", "target"] : ["padding", "reserve", "tag", "value", "marker", "target"]);
    for (const [choice, candidateTag] of choices) {
      const active: StoredClass = choice; const label = active.label; trace.log.push("static.read", candidateTag, label);
      assert.sameValue(Object.is(label, candidateTag + "-static"), true); assert.sameValue(typeof label, "string");
      const matched = item.tag === active.tag; trace.log.push("instanceof", tag, candidateTag, matched); assert.sameValue(Object.is(matched, tag === candidateTag), true); assert.sameValue(typeof matched, "boolean");
      expected.push("static.read", candidateTag, candidateTag + "-static", "instanceof", tag, candidateTag, tag === candidateTag);
    }
  }
  assert.sameValue(trace.made.length, 3); assert.compareArray(trace.log, expected);
}

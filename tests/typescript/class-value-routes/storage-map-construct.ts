/*---
description: Three class values cross a typed Map value before static reads and repeated mixed-argument construction.
features: [ts-class-value-route-storage, ts-class, ts-construct-signatures, ts-instanceof, ts-new-target, ts-static, ts-unions, ts-objects, ts-arrays, ts-map-set]
---*/
// Route: StoreFirst, StoreSecond and StoreThird cross a typed Map value; node preserves the target, new.target, identities, statics and fields.
type StoredValue = number | string | undefined | { id: number };
interface StoredItem { tag: string; value: StoredValue; marker: number; target: string; extra?: string; padding?: number; reserve?: boolean; }
interface StoredTrace { log: unknown[]; made: StoredItem[]; }
interface StoredClass { new (trace: StoredTrace, value: StoredValue, marker: number): StoredItem; label: string; }
class StoreFirst implements StoredItem {
  static label: string = "first-static"; tag: string; value: StoredValue; marker: number; target: string;
  constructor(trace: StoredTrace, value: StoredValue, marker: number) { this.tag = "first"; this.value = value; this.marker = marker; this.target = new.target.name; trace.made.push(this); trace.log.push("construct", "StoreFirst", trace, value, marker, this.target); }
}
class StoreSecond implements StoredItem {
  static label: string = "second-static"; extra: string = "layout-second"; tag: string; value: StoredValue; marker: number; target: string;
  constructor(trace: StoredTrace, value: StoredValue, marker: number) { this.tag = "second"; this.value = value; this.marker = marker; this.target = new.target.name; trace.made.push(this); trace.log.push("construct", "StoreSecond", trace, value, marker, this.target); }
}
class StoreThird implements StoredItem {
  static label: string = "third-static"; padding: number = 3; reserve: boolean = true; tag: string; value: StoredValue; marker: number; target: string;
  constructor(trace: StoredTrace, value: StoredValue, marker: number) { this.tag = "third"; this.value = value; this.marker = marker; this.target = new.target.name; trace.made.push(this); trace.log.push("construct", "StoreThird", trace, value, marker, this.target); }
}
const identity = { id: 7 }; const inputs: StoredValue[] = [0, -0, NaN, 0.5, 2147483648, "", "中", undefined, identity];
const choices: [StoredClass, string, string][] = [[StoreFirst, "first", "StoreFirst"], [StoreSecond, "second", "StoreSecond"], [StoreThird, "third", "StoreThird"]];
const registry = new Map<number, StoredClass>([[0, StoreFirst], [1, StoreSecond], [2, StoreThird]]);
for (const value of inputs) for (let slot = 0; slot < choices.length; slot++) {
  const [choice, tag, className] = choices[slot]; const trace: StoredTrace = { log: [], made: [] };
  const active = registry.get(slot); if (active === undefined) throw new Error("missing constructor");
  const label = active.label; trace.log.push("static.read", tag, label); assert.sameValue(Object.is(label, tag + "-static"), true); assert.sameValue(typeof label, "string");
  const first = new active(trace, value, 1), second = new active(trace, value, 2);
  for (const item of [first, second]) {
    assert.compareArray([item instanceof StoreFirst, item instanceof StoreSecond, item instanceof StoreThird, item instanceof active], [tag === "first", tag === "second", tag === "third", true]);
    const fields: [unknown, unknown][] = [[item.tag, tag], [item.value, value], [item.marker, item === first ? 1 : 2], [item.target, className], [item.extra, tag === "second" ? "layout-second" : undefined], [item.padding, tag === "third" ? 3 : undefined], [item.reserve, tag === "third" ? true : undefined]];
    for (const [actual, expected] of fields) { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
    assert.compareArray(Object.keys(item), tag === "first" ? ["tag", "value", "marker", "target"] : tag === "second" ? ["extra", "tag", "value", "marker", "target"] : ["padding", "reserve", "tag", "value", "marker", "target"]);
  }
  assert.sameValue(Object.is(first, trace.made[0]), true); assert.sameValue(Object.is(second, trace.made[1]), true); assert.sameValue(Object.is(first, second), false);
  assert.sameValue(typeof first, "object"); assert.sameValue(typeof second, "object"); assert.sameValue(trace.made.length, 2);
  assert.compareArray(trace.log, ["static.read", tag, tag + "-static", "construct", className, trace, value, 1, className, "construct", className, trace, value, 2, className]);
}

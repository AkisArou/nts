/*---
description: Stored constructor variables preserve independent static fields after a later mixed-value write.
features: [ts-class-value-route-storage, ts-class, ts-construct-signatures, ts-instanceof, ts-new-target, ts-static, ts-unions, ts-objects, ts-arrays]
---*/
// Route: typed variables hold three constructors; node stores the later static value only on the selected class and leaves the others unchanged.
type StoredValue = number | string | undefined | { id: number };
interface StoredItem { tag: string; value: StoredValue; marker: number; target: string; extra?: string; padding?: number; reserve?: boolean; }
interface StoredTrace { log: unknown[]; made: StoredItem[]; }
interface StoredClass { new (trace: StoredTrace, value: StoredValue, marker: number): StoredItem; label: string; current: StoredValue; }
class StoreFirst implements StoredItem {
  static label: string = "first-static"; static current: StoredValue = undefined; tag: string; value: StoredValue; marker: number; target: string;
  constructor(trace: StoredTrace, value: StoredValue, marker: number) { this.tag = "first"; this.value = value; this.marker = marker; this.target = new.target.name; trace.made.push(this); trace.log.push("construct", "StoreFirst", trace, value, marker, this.target); }
}
class StoreSecond implements StoredItem {
  static label: string = "second-static"; static current: StoredValue = undefined; extra: string = "layout-second"; tag: string; value: StoredValue; marker: number; target: string;
  constructor(trace: StoredTrace, value: StoredValue, marker: number) { this.tag = "second"; this.value = value; this.marker = marker; this.target = new.target.name; trace.made.push(this); trace.log.push("construct", "StoreSecond", trace, value, marker, this.target); }
}
class StoreThird implements StoredItem {
  static label: string = "third-static"; static current: StoredValue = undefined; padding: number = 3; reserve: boolean = true; tag: string; value: StoredValue; marker: number; target: string;
  constructor(trace: StoredTrace, value: StoredValue, marker: number) { this.tag = "third"; this.value = value; this.marker = marker; this.target = new.target.name; trace.made.push(this); trace.log.push("construct", "StoreThird", trace, value, marker, this.target); }
}
const identity = { id: 7 }; const inputs: StoredValue[] = [0, -0, NaN, 0.5, 2147483648, "", "中", undefined, identity];
const choices: [StoredClass, string, string][] = [[StoreFirst, "first", "StoreFirst"], [StoreSecond, "second", "StoreSecond"], [StoreThird, "third", "StoreThird"]];
for (const value of inputs) for (const [choice, tag, className] of choices) {
  const trace: StoredTrace = { log: [], made: [] }; const active: StoredClass = choice;
  for (const [other, otherTag] of choices) { other.current = undefined; trace.log.push("static.reset", otherTag, undefined); }
  active.current = value; trace.log.push("static.write", tag, value);
  const first = new active(trace, value, 1), second = new active(trace, value, 2);
  for (const item of [first, second]) {
    assert.compareArray([item instanceof StoreFirst, item instanceof StoreSecond, item instanceof StoreThird, item instanceof active], [tag === "first", tag === "second", tag === "third", true]);
    const fields: [unknown, unknown][] = [[item.tag, tag], [item.value, value], [item.marker, item === first ? 1 : 2], [item.target, className], [item.extra, tag === "second" ? "layout-second" : undefined], [item.padding, tag === "third" ? 3 : undefined], [item.reserve, tag === "third" ? true : undefined]];
    for (const [actual, expected] of fields) { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
    assert.compareArray(Object.keys(item), tag === "first" ? ["tag", "value", "marker", "target"] : tag === "second" ? ["extra", "tag", "value", "marker", "target"] : ["padding", "reserve", "tag", "value", "marker", "target"]);
  }
  assert.sameValue(Object.is(first, trace.made[0]), true); assert.sameValue(Object.is(second, trace.made[1]), true); assert.sameValue(Object.is(first, second), false);
  assert.sameValue(typeof first, "object"); assert.sameValue(typeof second, "object"); assert.sameValue(trace.made.length, 2);
  const expected: unknown[] = ["static.reset", "first", undefined, "static.reset", "second", undefined, "static.reset", "third", undefined, "static.write", tag, value, "construct", className, trace, value, 1, className, "construct", className, trace, value, 2, className];
  for (const [other, otherTag] of choices) {
    const actual = other.current, wanted = other === active ? value : undefined; trace.log.push("static.read", otherTag, actual);
    assert.sameValue(Object.is(actual, wanted), true); assert.sameValue(typeof actual, typeof wanted); expected.push("static.read", otherTag, wanted);
  }
  assert.compareArray(trace.log, expected);
}

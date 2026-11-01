/*---
description: A retained lookup closure reads the replacement class from a string-keyed constructor-union Map before construction.
features: [ts-class-value-route-selection, ts-class, ts-unions, ts-instanceof, ts-new-target, ts-static, ts-objects, ts-arrays, ts-map-set, ts-closures, ts-function-types]
---*/
// Route: a typed closure retains a Map and key across a class replacement; node constructs the new class rather than a captured old class.
type SelectionValue = number | string | undefined | { id: number };
interface SelectionItem { tag: string; value: SelectionValue; marker: number; target: string; extra?: string; padding?: number; reserve?: boolean; }
interface SelectionTrace { log: unknown[]; made: SelectionItem[]; }
class SelectFirst implements SelectionItem {
  static label: string = "first-static"; tag: string; value: SelectionValue; marker: number; target: string;
  constructor(trace: SelectionTrace, value: SelectionValue, marker: number) { this.tag = "first"; this.value = value; this.marker = marker; this.target = new.target.name; trace.made.push(this); trace.log.push("construct", "SelectFirst", trace, value, marker, this.target); }
}
class SelectSecond implements SelectionItem {
  static label: string = "second-static"; extra: string = "layout-second"; tag: string; value: SelectionValue; marker: number; target: string;
  constructor(trace: SelectionTrace, value: SelectionValue, marker: number) { this.tag = "second"; this.value = value; this.marker = marker; this.target = new.target.name; trace.made.push(this); trace.log.push("construct", "SelectSecond", trace, value, marker, this.target); }
}
class SelectThird implements SelectionItem {
  static label: string = "third-static"; padding: number = 3; reserve: boolean = true; tag: string; value: SelectionValue; marker: number; target: string;
  constructor(trace: SelectionTrace, value: SelectionValue, marker: number) { this.tag = "third"; this.value = value; this.marker = marker; this.target = new.target.name; trace.made.push(this); trace.log.push("construct", "SelectThird", trace, value, marker, this.target); }
}
type SelectionClass = typeof SelectFirst | typeof SelectSecond | typeof SelectThird;
const identity = { id: 19 }; const inputs: SelectionValue[] = [0, -0, NaN, 0.5, 2147483648, "", "中", undefined, identity];
const choices: [SelectionClass, string, string][] = [[SelectFirst, "first", "SelectFirst"], [SelectSecond, "second", "SelectSecond"], [SelectThird, "third", "SelectThird"]];
const registry = new Map<string, SelectionClass>([["left", SelectFirst], ["right", SelectSecond]]);
let leftIndex = 0, rightIndex = 1; const steps: [string, number][] = [["left", 2], ["right", 0], ["left", 1], ["right", 2], ["left", 0]];
function watch(registry: Map<string, SelectionClass>, key: string): () => SelectionClass { return () => { const ctor = registry.get(key); if (ctor === undefined) throw new Error("missing selection"); return ctor; }; }
for (const value of inputs) for (const [key, index] of steps) {
  const [choice, tag, className] = choices[index]; const [prior, priorTag] = choices[key === "left" ? leftIndex : rightIndex]; const trace: SelectionTrace = { log: [], made: [] };
  const read = watch(registry, key); const before = read();
  assert.sameValue(Object.is(before, prior), true); const oldLabel = before.label; trace.log.push("map.before", key, before, oldLabel);
  assert.sameValue(Object.is(oldLabel, priorTag + "-static"), true); assert.sameValue(typeof oldLabel, "string"); registry.set(key, choice); trace.log.push("map.write", key, choice);
  const active: SelectionClass = read();
  assert.sameValue(Object.is(active, choice), true); const label = active.label; trace.log.push("static.read", tag, label);
  assert.sameValue(Object.is(label, tag + "-static"), true); assert.sameValue(typeof label, "string");
  const first: SelectionItem = new active(trace, value, 1), second: SelectionItem = new active(trace, value, 2);
  for (const item of [first, second]) {
    assert.compareArray([item instanceof SelectFirst, item instanceof SelectSecond, item instanceof SelectThird, item instanceof active], [tag === "first", tag === "second", tag === "third", true]);
    const fields: [unknown, unknown][] = [[item.tag, tag], [item.value, value], [item.marker, item === first ? 1 : 2], [item.target, className], [item.extra, tag === "second" ? "layout-second" : undefined], [item.padding, tag === "third" ? 3 : undefined], [item.reserve, tag === "third" ? true : undefined]];
    for (const [actual, expected] of fields) { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
    assert.compareArray(Object.keys(item), tag === "first" ? ["tag", "value", "marker", "target"] : tag === "second" ? ["extra", "tag", "value", "marker", "target"] : ["padding", "reserve", "tag", "value", "marker", "target"]);
  }
  assert.sameValue(Object.is(first, trace.made[0]), true); assert.sameValue(Object.is(second, trace.made[1]), true); assert.sameValue(Object.is(first, second), false);
  assert.sameValue(typeof first, "object"); assert.sameValue(typeof second, "object"); assert.sameValue(trace.made.length, 2);
  assert.compareArray(trace.log, ["map.before", key, prior, priorTag + "-static", "map.write", key, choice, "static.read", tag, tag + "-static", "construct", className, trace, value, 1, className, "construct", className, trace, value, 2, className]);
  if (key === "left") leftIndex = index; else rightIndex = index;
}

/*---
description: Control for select-union-return; selected factory records preserve the same class-choice history and observations.
features: [ts-class-value-route-selection, ts-class, ts-unions, ts-instanceof, ts-new-target, ts-static, ts-objects, ts-arrays, ts-functions]
---*/
// Control: class choices become factory records, instances become literals, and class membership becomes tag comparison.
type SelectionValue = number | string | undefined | { id: number };
interface SelectionItem { tag: string; value: SelectionValue; marker: number; target: string; extra?: string; padding?: number; reserve?: boolean; }
interface SelectionTrace { log: unknown[]; made: SelectionItem[]; }
interface SelectionRecord { factory(trace: SelectionTrace, value: SelectionValue, marker: number): SelectionItem; tag: string; label: string; }
const SelectFirst: SelectionRecord = { tag: "first", label: "first-static", factory(trace, value, marker) {
  const item: SelectionItem = { tag: "first", value, marker, target: "SelectFirst" }; trace.made.push(item); trace.log.push("construct", "SelectFirst", trace, value, marker, item.target); return item;
} };
const SelectSecond: SelectionRecord = { tag: "second", label: "second-static", factory(trace, value, marker) {
  const item: SelectionItem = { extra: "layout-second", tag: "second", value, marker, target: "SelectSecond" }; trace.made.push(item); trace.log.push("construct", "SelectSecond", trace, value, marker, item.target); return item;
} };
const SelectThird: SelectionRecord = { tag: "third", label: "third-static", factory(trace, value, marker) {
  const item: SelectionItem = { padding: 3, reserve: true, tag: "third", value, marker, target: "SelectThird" }; trace.made.push(item); trace.log.push("construct", "SelectThird", trace, value, marker, item.target); return item;
} };
type SelectionClass = typeof SelectFirst | typeof SelectSecond | typeof SelectThird;
const identity = { id: 19 }; const inputs: SelectionValue[] = [0, -0, NaN, 0.5, 2147483648, "", "中", undefined, identity];
const choices: [SelectionClass, string, string][] = [[SelectFirst, "first", "SelectFirst"], [SelectSecond, "second", "SelectSecond"], [SelectThird, "third", "SelectThird"]];
function selectClass(index: number): SelectionClass { return index === 0 ? SelectFirst : index === 1 ? SelectSecond : SelectThird; }
for (const value of inputs) for (const index of [2, 0, 1, 2, 1, 0]) {
  const [choice, tag, className] = choices[index]; const trace: SelectionTrace = { log: [], made: [] };
  const active: SelectionClass = selectClass(index); assert.sameValue(Object.is(active, choice), true);
  const label = active.label; trace.log.push("static.read", tag, label); assert.sameValue(Object.is(label, tag + "-static"), true); assert.sameValue(typeof label, "string");
  const first: SelectionItem = active.factory(trace, value, 1), second: SelectionItem = active.factory(trace, value, 2);
  for (const item of [first, second]) {
    assert.compareArray([item.tag === SelectFirst.tag, item.tag === SelectSecond.tag, item.tag === SelectThird.tag, item.tag === active.tag], [tag === "first", tag === "second", tag === "third", true]);
    const fields: [unknown, unknown][] = [[item.tag, tag], [item.value, value], [item.marker, item === first ? 1 : 2], [item.target, className], [item.extra, tag === "second" ? "layout-second" : undefined], [item.padding, tag === "third" ? 3 : undefined], [item.reserve, tag === "third" ? true : undefined]];
    for (const [actual, expected] of fields) { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
    assert.compareArray(Object.keys(item), tag === "first" ? ["tag", "value", "marker", "target"] : tag === "second" ? ["extra", "tag", "value", "marker", "target"] : ["padding", "reserve", "tag", "value", "marker", "target"]);
  }
  assert.sameValue(Object.is(first, trace.made[0]), true); assert.sameValue(Object.is(second, trace.made[1]), true); assert.sameValue(Object.is(first, second), false);
  assert.sameValue(typeof first, "object"); assert.sameValue(typeof second, "object"); assert.sameValue(trace.made.length, 2);
  assert.compareArray(trace.log, ["static.read", tag, tag + "-static", "construct", className, trace, value, 1, className, "construct", className, trace, value, 2, className]);
}

/*---
description: A runtime-selected constructor union checks every instance against its own class, ancestors and descendants.
features: [ts-class-value-route-selection, ts-class, ts-unions, ts-instanceof, ts-new-target, ts-static, ts-objects, ts-arrays, ts-inheritance]
---*/
// Route: instanceof uses an input-selected union of three inherited class values; node matches the exact ancestor matrix and preserves new.target.
type SelectionValue = number | string | undefined | { id: number };
interface SelectionItem { tag: string; value: SelectionValue; marker: number; target: string; extra?: string; padding?: number; reserve?: boolean; }
interface SelectionTrace { log: unknown[]; made: SelectionItem[]; }
class SelectFirst implements SelectionItem {
  static label: string = "first-static"; tag: string; value: SelectionValue; marker: number; target: string;
  constructor(trace: SelectionTrace, value: SelectionValue, marker: number) { this.tag = "first"; this.value = value; this.marker = marker; this.target = new.target.name; trace.made.push(this); trace.log.push("construct", "SelectFirst", trace, value, marker, this.target); }
}
class SelectSecond extends SelectFirst {
  static override label: string = "second-static"; extra: string = "layout-second";
  constructor(trace: SelectionTrace, value: SelectionValue, marker: number) { super(trace, value, marker); this.tag = "second"; trace.log.push("construct", "SelectSecond", trace, value, marker, new.target.name); }
}
class SelectThird extends SelectSecond {
  static override label: string = "third-static"; padding: number = 3; reserve: boolean = true;
  constructor(trace: SelectionTrace, value: SelectionValue, marker: number) { super(trace, value, marker); this.tag = "third"; trace.log.push("construct", "SelectThird", trace, value, marker, new.target.name); }
}
type SelectionClass = typeof SelectFirst | typeof SelectSecond | typeof SelectThird;
const identity = { id: 19 }; const inputs: SelectionValue[] = [0, -0, NaN, 0.5, 2147483648, "", "中", undefined, identity];
const choices: [SelectionClass, string, string][] = [[SelectFirst, "first", "SelectFirst"], [SelectSecond, "second", "SelectSecond"], [SelectThird, "third", "SelectThird"]];
for (const value of inputs) {
  const trace: SelectionTrace = { log: [], made: [] };
  const items: SelectionItem[] = [new SelectFirst(trace, value, 1), new SelectSecond(trace, value, 2), new SelectThird(trace, value, 3)];
  const expected: unknown[] = ["construct", "SelectFirst", trace, value, 1, "SelectFirst", "construct", "SelectFirst", trace, value, 2, "SelectSecond", "construct", "SelectSecond", trace, value, 2, "SelectSecond", "construct", "SelectFirst", trace, value, 3, "SelectThird", "construct", "SelectSecond", trace, value, 3, "SelectThird", "construct", "SelectThird", trace, value, 3, "SelectThird"];
  assert.sameValue(trace.made.length, 3); assert.sameValue(Object.is(items[0], items[1]) || Object.is(items[0], items[2]) || Object.is(items[1], items[2]), false);
  for (const slot of [0, 1, 2]) {
    const item = items[slot], tag = choices[slot][1], className = choices[slot][2]; assert.sameValue(Object.is(item, trace.made[slot]), true); assert.sameValue(typeof item, "object");
    const fields: [unknown, unknown][] = [[item.tag, tag], [item.value, value], [item.marker, slot + 1], [item.target, className], [item.extra, slot > 0 ? "layout-second" : undefined], [item.padding, slot === 2 ? 3 : undefined], [item.reserve, slot === 2 ? true : undefined]];
    for (const [actual, wanted] of fields) { assert.sameValue(Object.is(actual, wanted), true); assert.sameValue(typeof actual, typeof wanted); }
    assert.compareArray(Object.keys(item), slot === 0 ? ["tag", "value", "marker", "target"] : slot === 1 ? ["tag", "value", "marker", "target", "extra"] : ["tag", "value", "marker", "target", "extra", "padding", "reserve"]);
    for (const index of [2, 0, 1]) {
      const active: SelectionClass = index === 0 ? SelectFirst : index === 1 ? SelectSecond : SelectThird; const candidateTag = choices[index][1]; const label = active.label;
      trace.log.push("static.read", candidateTag, label); assert.sameValue(Object.is(label, candidateTag + "-static"), true); assert.sameValue(typeof label, "string");
      const matched = item instanceof active; trace.log.push("instanceof", tag, candidateTag, matched); assert.sameValue(Object.is(matched, index <= slot), true); assert.sameValue(typeof matched, "boolean");
      expected.push("static.read", candidateTag, candidateTag + "-static", "instanceof", tag, candidateTag, index <= slot);
    }
  }
  assert.compareArray(trace.log, expected);
}

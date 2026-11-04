/*---
description: "Object grouping converts object callback keys immediately through admitted method bivariance."
features: [ts-library-addition-routes, ts-library-addition-route-collections, ts-map-set, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-objects, ts-unions, ts-null-undefined, ts-function-types, ts-spread, ts-errors, ts-class, ts-class-fields, ts-this, ts-interfaces, ts-to-primitive, ts-conversions, ts-unsound-bivariance, ts-mapped-types, ts-utility-types]
---*/
// Object.groupBy receives an object-returning callback through method bivariance; node runs toString before the next callback and merges distinct objects with the same converted key.
const log: string[] = [];
class Key {
  name: string; text: string;
  constructor(name: string, text: string) { log.push("construct:" + name); this.name = name; this.text = text; }
  toString(): string { log.push("toString:" + this.name); return this.text; }
  valueOf(): number { log.push("valueOf:" + this.name); return 99; }
}
interface Narrow { run(callback: (value: number, index: number) => PropertyKey): Partial<Record<PropertyKey, number[]>>; }
interface Wide { run(callback: (value: number, index: number) => PropertyKey | Key): Partial<Record<PropertyKey, number[]>>; }
for (const offset of [2, 10]) {
  const items = [offset, offset + 1, offset + 2], keys = [new Key("first", "same"), new Key("second", "same"), new Key("third", "other")];
  const narrow: Narrow = { run(callback: (value: number, index: number) => PropertyKey): Partial<Record<PropertyKey, number[]>> { log.push("run");
    return Object.groupBy(items, callback);
  } };
  const wide: Wide = narrow;
  function select(value: number, index: number): Key { log.push("callback:" + index + ":" + value); if (index === 1) keys[0].text = "late"; return keys[index]; }
  log.length = 0; const result = wide.run(select), same = result["same"], other = result["other"];
  assert.compareArray(log, ["run", "callback:0:" + offset, "toString:first", "callback:1:" + (offset + 1), "toString:second", "callback:2:" + (offset + 2), "toString:third"]);
  if (same === undefined || other === undefined) throw new Test262Error("missing group");
  assert.compareArray(Object.keys(result), ["same", "other"]); assert.compareArray(same, [offset, offset + 1]); assert.compareArray(other, [offset + 2]);
  assert.sameValue(keys[0].text, "late"); assert.sameValue("late" in result, false); assert.sameValue("valueOf" in result, false);
  assert.sameValue(same === items, false); assert.compareArray(items, [offset, offset + 1, offset + 2]);
}

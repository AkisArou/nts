/*---
description: String-ID record control for For-in through an interface excludes own and inherited symbols while visiting inherited string fields once.
features: [ts-symbol-route-listing, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-numbers, ts-strings, ts-unknown, ts-interfaces, ts-class, ts-class-fields, ts-inheritance, ts-optional-properties, ts-null-undefined]
---*/
// A Walkable parameter carries instances with enumerable prototype and own keys; node skips symbols and suppresses a shadowed prototype string key.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); }
const inherited = "token:inherited", own = "token:own";
interface Walkable { text: Record<string, string>; parent: Record<string, string>; fields: Record<string, number>; inheritedFields: Record<string, number>; order: string[]; inheritedOrder: string[]; }
function makeTarget(input: number, populated: boolean): Walkable { return { text: populated ? { ownText: "own", inheritedText: "shadow" } : {}, parent: { inheritedText: "parent", tail: "tail" }, fields: populated ? { [own]: input } : {}, inheritedFields: { [inherited]: input }, order: populated ? [own] : [], inheritedOrder: [inherited] }; }
function walk(target: Walkable): string[] { const result = keys(target); for (const key of Object.keys(target.parent)) if (!result.includes(key)) result.push(key); return result; }
function keys(target: Walkable): string[] { return Object.keys(target.text); }
function tokens(target: Walkable): string[] { return target.order.slice(); }
function read(target: Walkable): number { return target.inheritedFields[inherited]; }
function ownRead(target: Walkable): number | undefined { return target.fields[own]; }
function inheritedPresent(target: Walkable): boolean { return target.inheritedOrder.includes(inherited); }
function text(target: Walkable): string { return Object.hasOwn(target.text, "inheritedText") ? target.text.inheritedText : target.parent.inheritedText; }
for (const input of [-0, NaN, 17]) for (const populated of [false, true]) {
  const target = makeTarget(input, populated); same(Object.is(inherited, own), false);
  assert.compareArray(walk(target), populated ? ["ownText", "inheritedText", "tail"] : ["inheritedText", "tail"]);
  assert.compareArray(keys(target), populated ? ["ownText", "inheritedText"] : []); assert.compareArray(tokens(target), populated ? [own] : []);
  same(read(target), input); same(ownRead(target), populated ? input : undefined); same(inheritedPresent(target), true); same(text(target), populated ? "shadow" : "parent");
}

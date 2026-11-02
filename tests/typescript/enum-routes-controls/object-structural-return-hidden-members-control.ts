/*---
description: "Explicit object control: A smaller structural return keeps the actual enum object and all members hidden by its interface."
features: [ts-enum-routes, ts-enum-route-object-data, ts-functions, ts-arrays, ts-iteration, ts-unknown, ts-typeof-operator, ts-objects, ts-object-type, ts-readonly, ts-strings, ts-numbers, ts-interfaces, ts-generics, ts-generic-constraints, ts-tuples, ts-record, ts-computed-keys]
---*/
// A generic enum-object input returns through the one-field Head interface and is stored in a holder; Node preserves identity and enumerates the complete actual shape, including hidden reverse entries. Control: Return the same frozen plain enum-shaped objects through the unchanged structural interface; forward/reverse tables are assembled once and no object is rebuilt on a read.
function same(a: unknown, b: unknown): void { assert.sameValue(Object.is(a, b), true); assert.sameValue(typeof a, typeof b); }
function exact(a: readonly unknown[], b: readonly unknown[]): void { assert.compareArray(a, b); for (let i = 0; i < a.length; i++) same(a[i], b[i]); }
function listing(value: object, keys: readonly string[], values: readonly unknown[]): void {
  exact(Object.keys(value), keys); exact(Object.values(value), values); const entries = Object.entries(value); same(entries.length, keys.length);
  for (let i = 0; i < entries.length; i++) exact(entries[i], [keys[i], values[i]]);
  const visited: string[] = []; for (const key in value) visited.push(key); exact(visited, keys);
}
const FullForward = Object.freeze({ "Zero": 0, "Alias": 0, "Negative": -1, "Fraction": 0.5, "Text": "text" });
const FullReverse: Readonly<Record<number, string>> = Object.freeze({"0": "Alias", "-1": "Negative", "0.5": "Fraction"});
const Full = Object.freeze({ "Zero": FullForward["Zero"], [FullForward["Zero"]]: FullReverse[FullForward["Zero"]], "Alias": FullForward["Alias"], "Negative": FullForward["Negative"], [FullForward["Negative"]]: FullReverse[FullForward["Negative"]], "Fraction": FullForward["Fraction"], [FullForward["Fraction"]]: FullReverse[FullForward["Fraction"]], "Text": FullForward["Text"] });
const SmallForward = Object.freeze({ "Zero": 9 });
const SmallReverse: Readonly<Record<number, string>> = Object.freeze({"9": "Zero"});
const Small = Object.freeze({ "Zero": SmallForward["Zero"], [SmallForward["Zero"]]: SmallReverse[SmallForward["Zero"]] });
interface Head { readonly Zero: number; }
interface Holder { view: Head; }
const log: unknown[] = [];
function hide<T extends Head>(value: T): Head { log.push("hide", value); return value; }
const rows: [Head, number, string[], unknown[]][] = [[Full, 0, ["0", "Zero", "Alias", "Negative", "-1", "Fraction", "0.5", "Text"], ["Alias", 0, 0, -1, "Negative", 0.5, "Fraction", "text"]], [Small, 9, ["9", "Zero"], ["Zero", 9]], [Full, 0, ["0", "Zero", "Alias", "Negative", "-1", "Fraction", "0.5", "Text"], ["Alias", 0, 0, -1, "Negative", 0.5, "Fraction", "text"]]];
const retained: Head[] = [];
for (const [input, zero, keys, values] of rows) {
  log.length = 0; const holder: Holder = { view: hide(input) }; same(holder.view, input); same(holder.view.Zero, zero); retained.push(holder.view);
  listing(holder.view, keys, values); exact(log, ["hide", input]);
}
for (let i = 0; i < rows.length; i++) { same(retained[i], rows[i][0]); same(retained[i].Zero, rows[i][1]); listing(retained[i], rows[i][2], rows[i][3]); }

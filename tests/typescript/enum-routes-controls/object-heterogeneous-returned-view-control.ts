/*---
description: "Explicit object control: A typed result returns one of two heterogeneous enum objects with its complete runtime shape."
features: [ts-enum-routes, ts-enum-route-object-data, ts-functions, ts-arrays, ts-iteration, ts-unknown, ts-typeof-operator, ts-objects, ts-object-type, ts-readonly, ts-strings, ts-numbers, ts-type-aliases, ts-unions, ts-record, ts-interfaces, ts-tuples, ts-null-undefined, ts-computed-keys]
---*/
// Typed result record: a branch returns the original heterogeneous enum object; Node keeps numeric reverse entries and string-only forward entries in their exact positions. Control: Build each plain enum-shaped object once from its frozen forward and numeric reverse tables, then retain the same branch and typed result record.
function same(a: unknown, b: unknown): void { assert.sameValue(Object.is(a, b), true); assert.sameValue(typeof a, typeof b); }
function exact(a: readonly unknown[], b: readonly unknown[]): void { assert.compareArray(a, b); for (let i = 0; i < a.length; i++) same(a[i], b[i]); }
function listing(value: object, keys: readonly string[], values: readonly unknown[]): void {
  exact(Object.keys(value), keys); exact(Object.values(value), values); const entries = Object.entries(value); same(entries.length, keys.length);
  for (let i = 0; i < entries.length; i++) exact(entries[i], [keys[i], values[i]]);
  const visited: string[] = []; for (const key in value) visited.push(key); exact(visited, keys);
}
type Table = Readonly<Record<string, number | string>>;
const MixedAForward = Object.freeze({ "Zero": 0, "Text": "", "Alias": 0, "Step": 2.5, "Word": "word" });
const MixedAReverse: Readonly<Record<number, string>> = Object.freeze({"0": "Alias", "2.5": "Step"});
const MixedA = Object.freeze({ "Zero": MixedAForward["Zero"], [MixedAForward["Zero"]]: MixedAReverse[MixedAForward["Zero"]], "Text": MixedAForward["Text"], "Alias": MixedAForward["Alias"], "Step": MixedAForward["Step"], [MixedAForward["Step"]]: MixedAReverse[MixedAForward["Step"]], "Word": MixedAForward["Word"] });
const MixedBForward = Object.freeze({ "Zero": 1, "Text": "text", "Alias": 1, "Step": -2.5, "Word": "" });
const MixedBReverse: Readonly<Record<number, string>> = Object.freeze({"1": "Alias", "-2.5": "Step"});
const MixedB = Object.freeze({ "Zero": MixedBForward["Zero"], [MixedBForward["Zero"]]: MixedBReverse[MixedBForward["Zero"]], "Text": MixedBForward["Text"], "Alias": MixedBForward["Alias"], "Step": MixedBForward["Step"], [MixedBForward["Step"]]: MixedBReverse[MixedBForward["Step"]], "Word": MixedBForward["Word"] });
interface Result { table: Table; selected: boolean; }
const log: unknown[] = [];
function choose(second: boolean): Result { const table = second ? MixedB : MixedA; log.push(second ? "second" : "first", table); return { table, selected: second }; }
const rows: [boolean, Table, string[], unknown[]][] = [[false, MixedA, ["0", "Zero", "Text", "Alias", "Step", "2.5", "Word"], ["Alias", 0, "", 0, 2.5, "Step", "word"]], [true, MixedB, ["1", "Zero", "Text", "Alias", "Step", "-2.5", "Word"], ["Alias", 1, "text", 1, -2.5, "Step", ""]], [false, MixedA, ["0", "Zero", "Text", "Alias", "Step", "2.5", "Word"], ["Alias", 0, "", 0, 2.5, "Step", "word"]]];
for (const [choice, expected, keys, values] of rows) {
  log.length = 0; const result: Result = choose(choice); same(result.selected, choice); same(result.table, expected); listing(result.table, keys, values);
  same(result.table[result.table.Zero], "Alias"); same(result.table[result.table.Step], "Step");
  same(result.table[result.table.Text], undefined); same(result.table[result.table.Word], undefined);
  exact(log, [choice ? "second" : "first", expected]);
}

/*---
description: A symbol and its record travel as tuple elements without losing key identity.
features: [ts-symbol-route-keys, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-numbers, ts-strings, ts-unknown, ts-tuples, ts-type-aliases, ts-record, ts-null-undefined, ts-arrow-functions, ts-symbols, ts-computed-keys]
---*/
// A typed Entry tuple returns a fresh key beside its record; node reads and writes only the matching record even when every key has the same description.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); }
type Entry = [symbol, Record<symbol, number | undefined>];
function makeTarget(input: number | undefined): Entry { const key = Symbol("slot"); return [key, { [key]: input }]; }
function read(entry: Entry): number | undefined { return entry[1][entry[0]]; }
function write(entry: Entry, value: number): void { entry[1][entry[0]] = value; }
function has(entry: Entry, key: symbol): boolean { return key in entry[1]; }
function tokens(entry: Entry): symbol[] { return Object.getOwnPropertySymbols(entry[1]); }
const inputs: (number | undefined)[] = [undefined, -0, NaN, 29];
const entries: Entry[] = inputs.map(makeTarget);
for (let at = 0; at < entries.length; at++) {
  const entry = entries[at], other = entries[(at + 1) % entries.length], before = read(other);
  same(read(entry), inputs[at]); same(has(entry, entry[0]), true); same(has(entry, other[0]), false); same(Object.is(entry[0], other[0]), false);
  for (let index = 0; index < entries.length; index++) { same(Object.is(entry[0], entries[index][0]), index === at); same(has(entry, entries[index][0]), index === at); }
  assert.compareArray(tokens(entry), [entry[0]]); write(entry, 47); same(read(entry), 47); same(read(other), before);
  assert.compareArray(tokens(entry), [entry[0]]); same(has(entry, other[0]), false);
}

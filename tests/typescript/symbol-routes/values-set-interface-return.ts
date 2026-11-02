/*---
description: A Set returned through an interface retains symbol identities and insertion order through repeated additions.
features: [ts-symbol-route-values, ts-symbols, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-strings, ts-null-undefined, ts-map-set, ts-interfaces, ts-record]
---*/
// An interface return carries a Set of local symbols; node removes repeated identities, keeps equal descriptions distinct and reorders only deletion plus reinsert.
type Token = symbol;
function fresh(description: string | undefined): Token { return Symbol(description); }
interface Holder { members: Set<Token>; }
function make(values: Token[]): Holder { return { members: new Set<Token>(values) }; }
function add(holder: Holder, value: Token): Set<Token> { return holder.members.add(value); }
function has(holder: Holder, value: Token): boolean { return holder.members.has(value); }
function erase(holder: Holder, value: Token): boolean { return holder.members.delete(value); }
function keysOf(holder: Holder): Token[] { return Array.from(holder.members.values()); }
function sizeOf(holder: Holder): number { return holder.members.size; }
for (const description of [undefined, "", "same", "\ud83d\ude00"]) for (const count of [0, 1, 3]) {
  const first = fresh(description), second = fresh(description), absent = fresh(description), input = count === 0 ? [] : count === 1 ? [first] : [first, second, first];
  const holder: Holder = make(input), expected = count === 0 ? [] : count === 1 ? [first] : [first, second];
  assert.sameValue(first === second, false); assert.compareArray(keysOf(holder), expected); assert.sameValue(sizeOf(holder), expected.length); assert.sameValue(has(holder, absent), false); assert.sameValue(erase(holder, absent), false);
  assert.sameValue(add(holder, first), holder.members); assert.sameValue(add(holder, second), holder.members); assert.sameValue(add(holder, first), holder.members);
  assert.compareArray(keysOf(holder), [first, second]); assert.sameValue(sizeOf(holder), 2); assert.sameValue(has(holder, first), true); assert.sameValue(has(holder, second), true);
  assert.sameValue(erase(holder, first), true); assert.sameValue(has(holder, first), false); assert.compareArray(keysOf(holder), [second]);
  add(holder, first); assert.compareArray(keysOf(holder), [second, first]); assert.sameValue(sizeOf(holder), 2);
  assert.compareArray(input, count === 0 ? [] : count === 1 ? [first] : [first, second, first]);
}

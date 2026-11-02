/*---
description: Explicit string-key record control for A Set returned through an interface retains symbol identities and insertion order through repeated additions.
features: [ts-symbol-route-values, ts-symbols, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-strings, ts-null-undefined, ts-map-set, ts-interfaces, ts-record]
---*/
// An interface return carries a Set of local symbols; node removes repeated identities, keeps equal descriptions distinct and reorders only deletion plus reinsert.
type Token = string;
interface TokenData { description: string | undefined; registered: string | undefined; }
const tokenOrder: Token[] = [], tokenData: Record<string, TokenData> = {};
function fresh(description: string | undefined): Token { const id = "token:" + tokenOrder.length; tokenOrder.push(id); tokenData[id] = { description, registered: undefined }; return id; }
function tokenText(value: Token): string { const description = tokenData[value].description; return "Symbol(" + (description === undefined ? "" : description) + ")"; }
interface Members { keys: Token[]; present: Record<string, boolean>; }
interface Holder { members: Members; }
function make(values: Token[]): Holder { const holder: Holder = { members: { keys: [], present: {} } }; for (const value of values) add(holder, value); return holder; }
function add(holder: Holder, value: Token): Members { if (!holder.members.present[value]) { holder.members.keys.push(value); holder.members.present[value] = true; } return holder.members; }
function has(holder: Holder, value: Token): boolean { return holder.members.present[value] === true; }
function erase(holder: Holder, value: Token): boolean { if (!has(holder, value)) return false; holder.members.keys.splice(holder.members.keys.indexOf(value), 1); holder.members.present[value] = false; return true; }
function keysOf(holder: Holder): Token[] { return holder.members.keys.slice(); }
function sizeOf(holder: Holder): number { return holder.members.keys.length; }
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

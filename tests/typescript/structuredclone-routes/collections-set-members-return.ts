/*---
description: A typed Set return preserves shared object members and nested member references.
features: [ts-structuredclone-route-collections, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-unknown, ts-interfaces, ts-numbers, ts-optional-properties, ts-map-set]
---*/
// A returned Set<Member> carries a shared child as both a member and a nested field; node preserves membership order and one copied child.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); }
function fresh(actual: object, original: object, proto: object, keys: string[]): void {
  same(Object.is(actual, original), false); same(Object.getPrototypeOf(actual), proto); assert.compareArray(Object.keys(actual), keys);
}
interface Member { n: number; child?: Member; }
function input(numbers: number[]): Set<Member> {
  const result = new Set<Member>();
  for (const n of numbers) { const child: Member = { n }; result.add(child); result.add({ n, child }); result.add(child); }
  return result;
}
function copySet(source: Set<Member>): Set<Member> { return structuredClone(source); }
for (const numbers of [[], [-0], [NaN, 7, 7]]) {
  const source = input(numbers), result = copySet(source), before = Array.from(source), after = Array.from(result);
  fresh(result, source, Set.prototype, []); same(result.size, numbers.length * 2);
  assert.compareArray(after.map(member => member.n), before.map(member => member.n));
  for (let i = 0; i < after.length; i++) {
    fresh(after[i], before[i], Object.prototype, i % 2 === 0 ? ["n"] : ["n", "child"]); same(after[i].n, numbers[Math.floor(i / 2)]);
    same(after[i].child, i % 2 === 0 ? undefined : after[i - 1]); same(result.has(before[i]), false);
    after[i].n = 21; same(before[i].n, numbers[Math.floor(i / 2)]); before[i].n = 32; same(after[i].n, 21);
  }
  const extra: Member = { n: 1 }; result.add(extra); same(source.has(extra), false); source.clear(); same(result.size, before.length + 1);
}

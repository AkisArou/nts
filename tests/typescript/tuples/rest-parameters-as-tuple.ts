/*---
description: Rest parameters typed as a tuple behave as separate parameters, and Parameters<F> recovers that tuple.
features: [ts-tuples, ts-rest-parameters, ts-utility-types]
---*/
function join(...parts: [first: string, second: number, third?: boolean]): string {
  return parts.map(String).join("/");
}
type JoinArgs = Parameters<typeof join>;
const args: JoinArgs = ["a", 1];
assert.sameValue(join(...args), "a/1");
assert.sameValue(join("b", 2, true), "b/2/true");
assert.sameValue(join.length, 0);

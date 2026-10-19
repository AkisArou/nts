/*---
description: Assertions, satisfies and non-null assertions mixed in one chain over parsed JSON, each erased.
features: [ts-type-assertions, ts-satisfies, ts-non-null, ts-optional-chaining, ts-unknown]
---*/
type Payload = { users?: { id: number; tags?: string[] }[] };
const parsed: unknown = JSON.parse('{"users":[{"id":1,"tags":["a","b"]},{"id":2}]}');
const payload = parsed as Payload;
const first = payload.users![0];
const tagCount = first.tags?.length ?? 0;
const ids = payload.users!.map((u) => u.id) satisfies number[];
const secondTags = (payload.users![1] as { tags?: string[] }).tags;
assert.sameValue(tagCount, 2);
assert.compareArray(ids, [1, 2]);
assert.sameValue(secondTags, undefined);

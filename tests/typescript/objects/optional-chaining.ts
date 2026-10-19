/*---
description: Optional chaining short-circuits property reads, element reads and calls on null or undefined.
features: [ts-objects, ts-optional-chaining]
---*/
type ListNode = { value: number; next?: ListNode; tags?: string[]; visit?: () => number };
const list: ListNode = { value: 1, next: { value: 2, tags: ["t"], visit: () => 9 } };
assert.sameValue(list.next?.value, 2);
assert.sameValue(list.next?.next?.value, undefined);
assert.sameValue(list.next?.tags?.[0], "t");
assert.sameValue(list.tags?.[0], undefined);
assert.sameValue(list.next?.visit?.(), 9);
assert.sameValue(list.visit?.(), undefined);

/*---
description: A non-null assertion may appear in an assignment target and an increment.
features: [ts-non-null]
---*/
type Slot = { count: number } | undefined;
const slots: Slot[] = [{ count: 1 }, undefined];
slots[0]!.count = 10;
slots[0]!.count++;
const holder: { inner?: { text: string } } = { inner: { text: "a" } };
holder.inner!.text += "b";
assert.sameValue(slots[0]?.count, 11);
assert.sameValue(holder.inner?.text, "ab");

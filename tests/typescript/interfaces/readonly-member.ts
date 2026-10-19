/*---
description: A readonly interface member is still an ordinary property of the object that implements it.
features: [ts-interfaces, ts-readonly]
---*/
interface Identified {
  readonly id: number;
}
const record = { id: 1, note: "x" };
const view: Identified = record;
record.id = 2;
assert.sameValue(view.id, 2);
assert.sameValue(Object.getOwnPropertyDescriptor(view, "id")?.writable, true);

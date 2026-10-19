/*---
description: An optional parameter property is an own property even when its argument is omitted.
features: [ts-class, ts-parameter-properties, ts-optional-parameters]
---*/
class Note {
  constructor(public text: string, public author?: string) {}
}
const anonymous = new Note("hi");
assert.sameValue(anonymous.author, undefined);
assert.sameValue("author" in anonymous, true);
assert.sameValue(Object.keys(anonymous).join(","), "text,author");

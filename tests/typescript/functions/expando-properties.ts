/*---
description: Properties assigned to a function declaration after it are part of its type and its object.
features: [ts-functions, ts-expando]
---*/
function tag(text: string): string {
  return `${tag.open}${text}${tag.close}`;
}
tag.open = "<";
tag.close = ">";
assert.sameValue(tag("b"), "<b>");
tag.open = "[";
assert.sameValue(tag("i"), "[i>");
assert.sameValue(Object.keys(tag).join(","), "open,close");

/*---
description: A namespace merged with a function adds properties to the function.
features: [ts-namespace, ts-declaration-merging]
---*/
function greet(): string {
  return "hello";
}
namespace greet {
  export const punctuation = "!";
}
assert.sameValue(greet() + greet.punctuation, "hello!");

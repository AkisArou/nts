/*---
description: A `let` initialised from a literal widens to its primitive type and takes other values; a `const` keeps its literal.
features: [ts-literal-types]
---*/
const fixed = "draft";
let current = fixed;
current = "published";
const kinds: string[] = [fixed, current];
let count = 1;
count += 0.5;
assert.compareArray(kinds, ["draft", "published"]);
assert.sameValue(count, 1.5);

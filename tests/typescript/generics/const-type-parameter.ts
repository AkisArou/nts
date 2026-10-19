/*---
description: A const type parameter infers a literal type; the value it is given is unchanged and not frozen.
features: [ts-generics, ts-const-type-parameters, ts-literal-types]
---*/
function routes<const T extends readonly string[]>(paths: T): T {
  return paths;
}
const paths = routes(["/", "/about"]);
const firstPath: "/" = paths[0];
assert.sameValue(firstPath, "/");
assert.sameValue(paths.length, 2);
assert.sameValue(Object.isFrozen(paths), false);

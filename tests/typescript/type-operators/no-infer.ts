/*---
description: NoInfer keeps a fallback argument from widening a type parameter; the fallback value is returned unchanged.
features: [ts-type-operators, ts-generics, ts-utility-types]
---*/
function choose<T extends string>(options: T[], wanted: string, fallback: NoInfer<T>): T {
  return (options as string[]).includes(wanted) ? (wanted as T) : fallback;
}
const sizes: ("s" | "m" | "l")[] = ["s", "m", "l"];
assert.sameValue(choose(sizes, "m", "s"), "m");
assert.sameValue(choose(sizes, "xl", "l"), "l");

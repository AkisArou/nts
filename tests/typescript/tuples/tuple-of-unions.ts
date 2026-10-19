/*---
description: Each element of a tuple may itself be a union, narrowed independently.
features: [ts-tuples, ts-unions, ts-narrowing]
---*/
type Cell = [key: string | number, value: string | null];
function show([key, value]: Cell): string {
  const k = typeof key === "number" ? `#${key}` : key;
  return `${k}=${value ?? "none"}`;
}
assert.sameValue(show([1, "x"]), "#1=x");
assert.sameValue(show(["k", null]), "k=none");

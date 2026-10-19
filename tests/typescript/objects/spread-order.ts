/*---
description: In an object spread, later properties override earlier ones, and key order follows first appearance.
features: [ts-objects, ts-spread]
---*/
type Options = { color: string; size: number; bold?: boolean };
const defaults: Options = { color: "black", size: 12 };
const user: Partial<Options> = { size: 14, bold: true };
const merged: Options = { ...defaults, ...user };
const forced: Options = { ...merged, color: "red" };
const fallback: Options = { color: "red", size: 0, ...(merged as Partial<Options>) };
assert.sameValue(merged.size, 14);
assert.sameValue(Object.keys(merged).join(","), "color,size,bold");
assert.sameValue(forced.color, "red");
assert.sameValue(fallback.color, "black");

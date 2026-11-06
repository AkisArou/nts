/*---
description: "An empty Map at a recursive level is not a missing entry. Route: weighted-empty (control)"
features: [ts-recursive-type-routes, ts-recursive-type-route-collections]
---*/

// An empty Map at a recursive level is not a missing entry. Route: weighted-empty. Node prints collections-weighted-empty:ok.
type W0=Map<string,number>;type W1=Map<string,number|W0>;type W2=Map<string,number|W1>;type View=W0|W1|W2;
const leaf:W0=new Map<string,number>([["zero",-0],["nan",NaN]]);const middle:W1=new Map<string,number|W0>([["leaf",leaf],["other",5]]);const root:View=new Map<string,number|W1>([["middle",middle]]);
const empty:View=new Map();
assert.sameValue(empty.size,0);assert.sameValue(root.has('middle'),true);
console.log("collections-weighted-empty:ok");

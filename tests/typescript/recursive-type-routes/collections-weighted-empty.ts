/*---
description: "An empty Map at a recursive level is not a missing entry. Route: weighted-empty"
features: [ts-recursive-type-routes, ts-recursive-type-route-collections]
---*/

// An empty Map at a recursive level is not a missing entry. Route: weighted-empty. Node prints collections-weighted-empty:ok.
type Weighted=Map<string,number|Weighted>;type View=Weighted;
const leaf:Weighted=new Map<string,number|Weighted>([["zero",-0],["nan",NaN]]);const middle:Weighted=new Map<string,number|Weighted>([["leaf",leaf],["other",5]]);const root:View=new Map<string,number|Weighted>([["middle",middle]]);
const empty:View=new Map();
assert.sameValue(empty.size,0);assert.sameValue(root.has('middle'),true);
console.log("collections-weighted-empty:ok");

/*---
description: "A nested weighted Map lookup preserves its leaf identity. Route: weighted-get"
features: [ts-recursive-type-routes, ts-recursive-type-route-collections]
---*/

// A nested weighted Map lookup preserves its leaf identity. Route: weighted-get. Node prints collections-weighted-get:ok.
type Weighted=Map<string,number|Weighted>;type View=Weighted;
const leaf:Weighted=new Map<string,number|Weighted>([["zero",-0],["nan",NaN]]);const middle:Weighted=new Map<string,number|Weighted>([["leaf",leaf],["other",5]]);const root:View=new Map<string,number|Weighted>([["middle",middle]]);
const middleMap=root.get('middle');if(typeof middleMap==='number'||middleMap===undefined)throw new Error('missing');const leafMap=middleMap.get('leaf');if(typeof leafMap==='number'||leafMap===undefined)throw new Error('missing');
assert.sameValue(leafMap.get('zero'),-0);assert.sameValue(leafMap.get('nan'),NaN);
console.log("collections-weighted-get:ok");

/*---
description: "Recursive weighted Map levels retain their distinct sizes. Route: weighted-size"
features: [ts-recursive-type-routes, ts-recursive-type-route-collections]
---*/

// Recursive weighted Map levels retain their distinct sizes. Route: weighted-size. Node prints collections-weighted-size:ok.
type Weighted=Map<string,number|Weighted>;type View=Weighted;
const leaf:Weighted=new Map<string,number|Weighted>([["zero",-0],["nan",NaN]]);const middle:Weighted=new Map<string,number|Weighted>([["leaf",leaf],["other",5]]);const root:View=new Map<string,number|Weighted>([["middle",middle]]);
const middleMap=root.get('middle');if(typeof middleMap==='number'||middleMap===undefined)throw new Error('missing');const leafMap=middleMap.get('leaf');if(typeof leafMap==='number'||leafMap===undefined)throw new Error('missing');
assert.sameValue(root.size,1);assert.sameValue(middleMap.size,2);assert.sameValue(leafMap.size,2);
console.log("collections-weighted-size:ok");

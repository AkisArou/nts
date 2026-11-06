/*---
description: "Recursive weighted Map levels retain their distinct sizes. Route: weighted-size (control)"
features: [ts-recursive-type-routes, ts-recursive-type-route-collections]
---*/

// Recursive weighted Map levels retain their distinct sizes. Route: weighted-size. Node prints collections-weighted-size:ok.
type W0=Map<string,number>;type W1=Map<string,number|W0>;type W2=Map<string,number|W1>;type View=W0|W1|W2;
const leaf:W0=new Map<string,number>([["zero",-0],["nan",NaN]]);const middle:W1=new Map<string,number|W0>([["leaf",leaf],["other",5]]);const root:View=new Map<string,number|W1>([["middle",middle]]);
const middleMap=root.get('middle');if(typeof middleMap==='number'||middleMap===undefined)throw new Error('missing');const leafMap=middleMap.get('leaf');if(typeof leafMap==='number'||leafMap===undefined)throw new Error('missing');
assert.sameValue(root.size,1);assert.sameValue(middleMap.size,2);assert.sameValue(leafMap.size,2);
console.log("collections-weighted-size:ok");

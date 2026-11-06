/*---
description: "A nested weighted Map lookup preserves its leaf identity. Route: weighted-get (control)"
features: [ts-recursive-type-routes, ts-recursive-type-route-collections]
---*/

// A nested weighted Map lookup preserves its leaf identity. Route: weighted-get. Node prints collections-weighted-get:ok.
type W0=Map<string,number>;type W1=Map<string,number|W0>;type W2=Map<string,number|W1>;type View=W0|W1|W2;
const leaf:W0=new Map<string,number>([["zero",-0],["nan",NaN]]);const middle:W1=new Map<string,number|W0>([["leaf",leaf],["other",5]]);const root:View=new Map<string,number|W1>([["middle",middle]]);
const middleMap=root.get('middle');if(typeof middleMap==='number'||middleMap===undefined)throw new Error('missing');const leafMap=middleMap.get('leaf');if(typeof leafMap==='number'||leafMap===undefined)throw new Error('missing');
assert.sameValue(leafMap.get('zero'),-0);assert.sameValue(leafMap.get('nan'),NaN);
console.log("collections-weighted-get:ok");

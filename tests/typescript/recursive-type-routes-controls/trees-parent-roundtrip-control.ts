/*---
description: "A recursive child returns to the root through parent pointers. Route: typed recursive parent and kids (control)"
features: [ts-recursive-type-routes, ts-recursive-type-route-trees]
---*/

// A recursive child returns to the root through parent pointers. Route: typed recursive parent and kids. Node prints trees-parent-roundtrip:ok.
interface IndexedParent{id:string;parent:number;kids:number[]};
const cells:IndexedParent[]=[{id:'r',parent:-1,kids:[1]},{id:'m',parent:0,kids:[2]},{id:'l',parent:1,kids:[]}];assert.sameValue(cells[cells[2].parent].parent,0);assert.sameValue(cells[cells[0].kids[0]].kids[0],2);
console.log("trees-parent-roundtrip:ok");

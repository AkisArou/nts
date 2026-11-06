/*---
description: "A write through a recursive parent alias remains visible to its child path. Route: typed recursive parent and kids (control)"
features: [ts-recursive-type-routes, ts-recursive-type-route-trees]
---*/

// A write through a recursive parent alias remains visible to its child path. Route: typed recursive parent and kids. Node prints trees-parent-write-through:ok.
interface IndexedParent{id:string;parent:number;kids:number[]};
const cells:IndexedParent[]=[{id:'r',parent:-1,kids:[1]},{id:'m',parent:0,kids:[2]},{id:'l',parent:1,kids:[]}];cells[cells[2].parent].id='updated';assert.sameValue(cells[cells[0].kids[0]].id,'updated');assert.sameValue(cells[cells[2].parent].id,'updated');
console.log("trees-parent-write-through:ok");

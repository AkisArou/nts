/*---
description: "A write through one recursive Map path is observed through a shared path. Route: graph-shared-write"
features: [ts-recursive-type-routes, ts-recursive-type-route-collections]
---*/

// A write through one recursive Map path is observed through a shared path. Route: graph-shared-write. Node prints collections-graph-shared-write:ok.
type Graph=Map<string,Graph>;
const root:Graph=new Map(),child:Graph=new Map();root.set('a',child);root.set('b',child);const left=root.get('a');if(left===undefined)throw new Error('missing');left.set('self',left);assert.sameValue(root.get('b')?.get('self')===child,true);
console.log("collections-graph-shared-write:ok");

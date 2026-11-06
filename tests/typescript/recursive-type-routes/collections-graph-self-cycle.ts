/*---
description: "A recursive Map graph can follow a self cycle back to its original identity. Route: graph-self-cycle"
features: [ts-recursive-type-routes, ts-recursive-type-route-collections]
---*/

// A recursive Map graph can follow a self cycle back to its original identity. Route: graph-self-cycle. Node prints collections-graph-self-cycle:ok.
type Graph=Map<string,Graph>;
const graph:Graph=new Map();graph.set('self',graph);assert.sameValue(graph.get('self')===graph,true);
console.log("collections-graph-self-cycle:ok");

/*---
description: "A recursive Map graph can follow a self cycle back to its original identity. Route: graph-self-cycle (control)"
features: [ts-recursive-type-routes, ts-recursive-type-route-collections]
---*/

// A recursive Map graph can follow a self cycle back to its original identity. Route: graph-self-cycle. Node prints collections-graph-self-cycle:ok.
interface Indexed{edges:Map<string,number>};
const nodes:Indexed[]=[{edges:new Map()}];nodes[0].edges.set('self',0);assert.sameValue(nodes[0].edges.get('self'),0);
console.log("collections-graph-self-cycle:ok");

/*---
description: "A write through one recursive Map path is observed through a shared path. Route: graph-shared-write (control)"
features: [ts-recursive-type-routes, ts-recursive-type-route-collections]
---*/

// A write through one recursive Map path is observed through a shared path. Route: graph-shared-write. Node prints collections-graph-shared-write:ok.
interface Indexed{edges:Map<string,number>};
const nodes:Indexed[]=[{edges:new Map([['a',1],['b',1]])},{edges:new Map()}];const left=nodes[0].edges.get('a');if(left===undefined)throw new Error('missing');nodes[left].edges.set('self',left);const right=nodes[0].edges.get('b');if(right===undefined)throw new Error('missing');assert.sameValue(nodes[right].edges.get('self'),1);
console.log("collections-graph-shared-write:ok");

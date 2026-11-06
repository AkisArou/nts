/*---
description: "Two recursive Map keys retain the identity of their shared child. Route: graph-shared-child (control)"
features: [ts-recursive-type-routes, ts-recursive-type-route-collections]
---*/

// Two recursive Map keys retain the identity of their shared child. Route: graph-shared-child. Node prints collections-graph-shared-child:ok.
interface Indexed{edges:Map<string,number>};
const nodes:Indexed[]=[{edges:new Map([['a',1],['b',1]])},{edges:new Map()}];assert.sameValue(nodes[0].edges.get('a')===nodes[0].edges.get('b'),true);
console.log("collections-graph-shared-child:ok");

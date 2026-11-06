/*---
description: "Two recursive Map keys retain the identity of their shared child. Route: graph-shared-child"
features: [ts-recursive-type-routes, ts-recursive-type-route-collections]
---*/

// Two recursive Map keys retain the identity of their shared child. Route: graph-shared-child. Node prints collections-graph-shared-child:ok.
type Graph=Map<string,Graph>;
const root:Graph=new Map(),child:Graph=new Map();root.set('a',child);root.set('b',child);assert.sameValue(root.get('a')===root.get('b'),true);
console.log("collections-graph-shared-child:ok");

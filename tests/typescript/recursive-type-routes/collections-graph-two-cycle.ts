/*---
description: "A visited Set terminates traversal around a two-node recursive Map cycle. Route: graph-two-cycle"
features: [ts-recursive-type-routes, ts-recursive-type-route-collections]
---*/

// A visited Set terminates traversal around a two-node recursive Map cycle. Route: graph-two-cycle. Node prints collections-graph-two-cycle:ok.
type Graph=Map<string,Graph>;
const a:Graph=new Map(),b:Graph=new Map();a.set('next',b);b.set('next',a);const visited=new Set<Graph>();function visit(g:Graph):void{if(visited.has(g))return;visited.add(g);for(const child of g.values())visit(child);}visit(a);assert.sameValue(visited.size,2);
console.log("collections-graph-two-cycle:ok");

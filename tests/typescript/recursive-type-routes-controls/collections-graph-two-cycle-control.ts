/*---
description: "A visited Set terminates traversal around a two-node recursive Map cycle. Route: graph-two-cycle (control)"
features: [ts-recursive-type-routes, ts-recursive-type-route-collections]
---*/

// A visited Set terminates traversal around a two-node recursive Map cycle. Route: graph-two-cycle. Node prints collections-graph-two-cycle:ok.
interface Indexed{edges:Map<string,number>};
const nodes:Indexed[]=[{edges:new Map([['next',1]])},{edges:new Map([['next',0]])}];const visited=new Set<number>();function visit(i:number):void{if(visited.has(i))return;visited.add(i);for(const child of nodes[i].edges.values())visit(child);}visit(0);assert.sameValue(visited.size,2);
console.log("collections-graph-two-cycle:ok");

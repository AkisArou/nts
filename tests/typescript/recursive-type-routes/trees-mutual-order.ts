/*---
description: "Mutually recursive forest and grove retain traversal order. Route: mutual-order"
features: [ts-recursive-type-routes, ts-recursive-type-route-trees]
---*/

// Mutually recursive forest and grove retain traversal order. Route: mutual-order; node prints trees-mutual-order:ok.
interface Forest{trees:Grove[]};interface Grove{value:number;forest:Forest};type View=Forest;
const root:View={trees:[{value:1,forest:{trees:[{value:2,forest:{trees:[]}}]}},{value:3,forest:{trees:[]}}]};
const log:string[]=[];function walk(f:View):void{for(const t of f.trees){log.push(String(t.value));walk(t.forest);}}walk(root);
assert.compareArray(log,["1","2","3"]);
console.log("trees-mutual-order:ok");

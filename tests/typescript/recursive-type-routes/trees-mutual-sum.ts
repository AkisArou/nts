/*---
description: "Mutually recursive forest and grove retain numeric leaves. Route: mutual-sum"
features: [ts-recursive-type-routes, ts-recursive-type-route-trees]
---*/

// Mutually recursive forest and grove retain numeric leaves. Route: mutual-sum; node prints trees-mutual-sum:ok.
interface Forest{trees:Grove[]};interface Grove{value:number;forest:Forest};type View=Forest;
const root:View={trees:[{value:1,forest:{trees:[{value:2,forest:{trees:[]}}]}},{value:3,forest:{trees:[]}}]};
function sum(f:View):number{let n=0;for(const t of f.trees){n+=t.value;n+=sum(t.forest);}return n;}
assert.sameValue(sum(root),6);
console.log("trees-mutual-sum:ok");

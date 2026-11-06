/*---
description: "An n-ary tree retains every node and empty children. Route: nary-size (control)"
features: [ts-recursive-type-routes, ts-recursive-type-route-trees]
---*/

// An n-ary tree retains every node and empty children. Route: nary-size; node prints trees-nary-size:ok.
type N0={value:number;children:[]};type N1={value:number;children:N0[]};type N2={value:number;children:(N0|N1)[]};type View=N0|N1|N2;
const root:View={value:1,children:[{value:2,children:[{value:4,children:[]}]},{value:3,children:[]}]};
function count(n:View):number{let k=1;for(const child of n.children)k+=count(child);return k;}
assert.sameValue(count(root),4);
console.log("trees-nary-size:ok");

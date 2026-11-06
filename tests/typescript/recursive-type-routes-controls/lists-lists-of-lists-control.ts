/*---
description: "A recursive outer list retains distinct inner recursive lists. Route: nested recursive interfaces (control)"
features: [ts-recursive-type-routes, ts-recursive-type-route-lists]
---*/

// A recursive outer list retains distinct inner recursive lists. Route: nested recursive interfaces. Node prints lists-lists-of-lists:ok.
type N0={value:number;next:null};type N1={value:number;next:N0};type L0={head:N1;next:null};type L1={head:N1;next:L0};type Layer=L0|L1;
const outer:Layer={head:{value:1,next:{value:2,next:null}},next:{head:{value:3,next:{value:-0,next:null}},next:null}};const values:number[]=[];for(let layer:Layer|null=outer;layer!==null;layer=layer.next)for(let n:N1|N0|null=layer.head;n!==null;n=n.next)values.push(n.value);
assert.compareArray(values,[1,2,3,-0]);
console.log("lists-lists-of-lists:ok");

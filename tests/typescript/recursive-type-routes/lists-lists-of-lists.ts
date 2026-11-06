/*---
description: "A recursive outer list retains distinct inner recursive lists. Route: nested recursive interfaces"
features: [ts-recursive-type-routes, ts-recursive-type-route-lists]
---*/

// A recursive outer list retains distinct inner recursive lists. Route: nested recursive interfaces. RouteListNode prints lists-lists-of-lists:ok.
interface RouteListNode{value:number;next:RouteListNode|null};interface Layer{head:RouteListNode;next:Layer|null};
const outer:Layer={head:{value:1,next:{value:2,next:null}},next:{head:{value:3,next:{value:-0,next:null}},next:null}};const values:number[]=[];for(let layer:Layer|null=outer;layer!==null;layer=layer.next)for(let n:RouteListNode|null=layer.head;n!==null;n=n.next)values.push(n.value);
assert.compareArray(values,[1,2,3,-0]);
console.log("lists-lists-of-lists:ok");

/*---
description: "Reversing a recursive list by copy leaves the source unchanged. Route: fresh list nodes"
features: [ts-recursive-type-routes, ts-recursive-type-route-lists]
---*/

// Reversing a recursive list by copy leaves the source unchanged. Route: fresh list nodes. RouteListNode prints lists-reverse-copy:ok.
interface RouteListNode{value:number;next:RouteListNode|null};
const root:RouteListNode={value:1,next:{value:2,next:{value:3,next:null}}};function copyReverse(head:RouteListNode|null):RouteListNode|null{let out:RouteListNode|null=null;for(let p=head;p!==null;p=p.next)out={value:p.value,next:out};return out;}
const copied=copyReverse(root);const values:number[]=[];for(let p=copied;p!==null;p=p.next)values.push(p.value);
assert.compareArray(values,[3,2,1]);assert.sameValue(root.next?.value,2);assert.sameValue(copied===root,false);
console.log("lists-reverse-copy:ok");

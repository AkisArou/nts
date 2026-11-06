/*---
description: "Appending to a recursive linked list retains its existing prefix. Route: new tail node"
features: [ts-recursive-type-routes, ts-recursive-type-route-lists]
---*/

// Appending to a recursive linked list retains its existing prefix. Route: new tail node. RouteListNode prints lists-append-tail:ok.
interface RouteListNode{value:number;next:RouteListNode|null};
const root:RouteListNode={value:1,next:{value:2,next:null}};function append(head:RouteListNode,value:number):void{let p=head;while(p.next!==null)p=p.next;p.next={value,next:null};}
append(root,3);const values:number[]=[];for(let p:RouteListNode|null=root;p!==null;p=p.next)values.push(p.value);
assert.compareArray(values,[1,2,3]);assert.sameValue(root.next?.next?.value,3);
console.log("lists-append-tail:ok");

/*---
description: "Reversing a mutable recursive list in place keeps each value and link. Route: mutated next reference"
features: [ts-recursive-type-routes, ts-recursive-type-route-lists]
---*/

// Reversing a mutable recursive list in place keeps each value and link. Route: mutated next reference. RouteListNode prints lists-reverse-inplace:ok.
interface RouteListNode{value:number;next:RouteListNode|null};
const root:RouteListNode={value:1,next:{value:2,next:{value:3,next:null}}};function reverse(head:RouteListNode|null):RouteListNode|null{let prev:RouteListNode|null=null,cur=head;while(cur!==null){const following=cur.next;cur.next=prev;prev=cur;cur=following;}return prev;}
const result=reverse(root);const actual:number[]=[];let p=result;while(p!==null){actual.push(p.value);p=p.next;}
assert.compareArray(actual,[3,2,1]);assert.sameValue(result?.next?.next===root,true);
console.log("lists-reverse-inplace:ok");

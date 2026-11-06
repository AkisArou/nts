/*---
description: "Removing the middle recursive node leaves its neighbours linked. Route: mutable next field"
features: [ts-recursive-type-routes, ts-recursive-type-route-lists]
---*/

// Removing the middle recursive node leaves its neighbours linked. Route: mutable next field. RouteListNode prints lists-remove-middle:ok.
interface RouteListNode{value:number;next:RouteListNode|null};
const root:RouteListNode={value:1,next:{value:2,next:{value:3,next:null}}};const removed=root.next;if(removed===null)throw new Error('missing');root.next=removed.next;
const values:number[]=[];for(let p:RouteListNode|null=root;p!==null;p=p.next)values.push(p.value);assert.compareArray(values,[1,3]);assert.sameValue(root.next?.value,3);assert.sameValue(removed.value,2);
console.log("lists-remove-middle:ok");

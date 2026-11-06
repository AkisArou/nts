/*---
description: "Removing the middle recursive node leaves its neighbours linked. Route: mutable next field (control)"
features: [ts-recursive-type-routes, ts-recursive-type-route-lists]
---*/

// Removing the middle recursive node leaves its neighbours linked. Route: mutable next field. Node prints lists-remove-middle:ok.
interface Cell{value:number;next:number};
const cells:Cell[]=[{value:1,next:1},{value:2,next:2},{value:3,next:-1}];const removed=cells[0].next;cells[0].next=cells[removed].next;
const values:number[]=[];for(let i=0;i!==-1;i=cells[i].next)values.push(cells[i].value);assert.compareArray(values,[1,3]);assert.sameValue(cells[cells[0].next].value,3);assert.sameValue(cells[removed].value,2);
console.log("lists-remove-middle:ok");

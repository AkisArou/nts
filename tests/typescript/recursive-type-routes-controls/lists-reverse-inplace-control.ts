/*---
description: "Reversing a mutable recursive list in place keeps each value and link. Route: mutated next reference (control)"
features: [ts-recursive-type-routes, ts-recursive-type-route-lists]
---*/

// Reversing a mutable recursive list in place keeps each value and link. Route: mutated next reference. Node prints lists-reverse-inplace:ok.
interface Cell{value:number;next:number};
const cells:Cell[]=[{value:1,next:1},{value:2,next:2},{value:3,next:-1}];let first=0;let prev=-1;let cur=first;while(cur!==-1){const following=cells[cur].next;cells[cur].next=prev;prev=cur;cur=following;}first=prev;
const actual:number[]=[];let p=first;while(p!==-1){actual.push(cells[p].value);p=cells[p].next;}
assert.compareArray(actual,[3,2,1]);assert.sameValue(cells[2].next===1&&cells[1].next===0,true);
console.log("lists-reverse-inplace:ok");

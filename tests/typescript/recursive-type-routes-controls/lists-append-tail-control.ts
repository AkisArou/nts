/*---
description: "Appending to a recursive linked list retains its existing prefix. Route: new tail node (control)"
features: [ts-recursive-type-routes, ts-recursive-type-route-lists]
---*/

// Appending to a recursive linked list retains its existing prefix. Route: new tail node. Node prints lists-append-tail:ok.
interface Cell{value:number;next:number};
const cells:Cell[]=[{value:1,next:1},{value:2,next:-1}];let p=0;while(cells[p].next!==-1)p=cells[p].next;cells.push({value:3,next:-1});cells[p].next=cells.length-1;
const values:number[]=[];for(let i=0;i!==-1;i=cells[i].next)values.push(cells[i].value);
assert.compareArray(values,[1,2,3]);assert.sameValue(cells[2].value,3);
console.log("lists-append-tail:ok");

/*---
description: "A five-hundred-call recursive fold traverses a long list. Route: loop-built list, bounded recursion (control)"
features: [ts-recursive-type-routes, ts-recursive-type-route-lists]
---*/

// A five-hundred-call recursive fold traverses a long list. Route: loop-built list, bounded recursion. Node prints lists-long-recursive-sum:ok.
interface IndexedRNode {value:number;next:number}
const cells:IndexedRNode[]=[];for(let i=499;i>=0;i--)cells.push({value:1,next:cells.length-1});
function sum(cur:number):number{return cur===-1?0:cells[cur].value+sum(cells[cur].next);}
assert.sameValue(sum(cells.length-1),500);
console.log("lists-long-recursive-sum:ok");

/*---
description: "A thousand-node recursive list is traversed iteratively. Route: loop-built long list (control)"
features: [ts-recursive-type-routes, ts-recursive-type-route-lists]
---*/

// A thousand-node recursive list is traversed iteratively. Route: loop-built long list. Node prints lists-long-thousand:ok.
interface IndexedRNode {value:number;next:number}
const cells:IndexedRNode[]=[];for(let i=999;i>=0;i--)cells.push({value:i,next:cells.length-1});
let n=0;let total=0;let cur=cells.length-1;while(cur!==-1){n++;total+=cells[cur].value;cur=cells[cur].next;}
assert.sameValue(n,1000);assert.sameValue(total,499500);
console.log("lists-long-thousand:ok");

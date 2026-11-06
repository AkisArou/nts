/*---
description: "A thousand-node recursive list is traversed iteratively. Route: loop-built long list"
features: [ts-recursive-type-routes, ts-recursive-type-route-lists]
---*/

// A thousand-node recursive list is traversed iteratively. Route: loop-built long list. Node prints lists-long-thousand:ok.
interface LongRNode {value:number;next:LongRNode|null}
let head:LongRNode|null=null;for(let i=999;i>=0;i--)head={value:i,next:head};
let n=0;let total=0;let cur=head;while(cur!==null){n++;total+=cur.value;cur=cur.next;}
assert.sameValue(n,1000);assert.sameValue(total,499500);
console.log("lists-long-thousand:ok");

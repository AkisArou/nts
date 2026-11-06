/*---
description: "A five-hundred-call recursive fold traverses a long list. Route: loop-built list, bounded recursion"
features: [ts-recursive-type-routes, ts-recursive-type-route-lists]
---*/

// A five-hundred-call recursive fold traverses a long list. Route: loop-built list, bounded recursion. Node prints lists-long-recursive-sum:ok.
interface LongRNode {value:number;next:LongRNode|null}
let head:LongRNode|null=null;for(let i=499;i>=0;i--)head={value:1,next:head};
function sum(cur:LongRNode|null):number{return cur===null?0:cur.value+sum(cur.next);}
assert.sameValue(sum(head),500);
console.log("lists-long-recursive-sum:ok");

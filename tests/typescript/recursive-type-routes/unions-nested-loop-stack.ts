/*---
description: "An explicit stack and recursion agree on recursive array leaf order. Route: nested-loop-stack"
features: [ts-recursive-type-routes, ts-recursive-type-route-unions]
---*/

// An explicit stack and recursion agree on recursive array leaf order. Route: nested-loop-stack. Node prints unions-nested-loop-stack:ok.
type Nested=number|Nested[];type View=Nested;
function flatten(v:View):number[]{if(typeof v==='number')return [v];const out:number[]=[];for(const child of v)out.push(...flatten(child));return out;}
const input:View=[1,[2,[3]],4];const stack:View[]=[input];const out:number[]=[];while(stack.length){const x=stack.pop();if(x===undefined)break;if(typeof x==='number')out.push(x);else for(let i=x.length-1;i>=0;i--)stack.push(x[i]);}
assert.compareArray(out,flatten(input));
console.log("unions-nested-loop-stack:ok");

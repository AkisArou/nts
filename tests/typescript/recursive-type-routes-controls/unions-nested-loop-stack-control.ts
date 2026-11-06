/*---
description: "An explicit stack and recursion agree on recursive array leaf order. Route: nested-loop-stack (control)"
features: [ts-recursive-type-routes, ts-recursive-type-route-unions]
---*/

// An explicit stack and recursion agree on recursive array leaf order. Route: nested-loop-stack. Node prints unions-nested-loop-stack:ok.
type N0=number;type N1=N0|N0[];type N2=N0|N1[];type N3=N0|N2[];type View=N0|N1|N2|N3;
function flatten(v:View):number[]{if(typeof v==='number')return [v];const out:number[]=[];for(const child of v)out.push(...flatten(child));return out;}
const input:View=[1,[2,[3]],4];const stack:View[]=[input];const out:number[]=[];while(stack.length){const x=stack.pop();if(x===undefined)break;if(typeof x==='number')out.push(x);else for(let i=x.length-1;i>=0;i--)stack.push(x[i]);}
assert.compareArray(out,flatten(input));
console.log("unions-nested-loop-stack:ok");

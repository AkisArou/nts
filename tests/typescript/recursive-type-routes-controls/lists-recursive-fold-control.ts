/*---
description: "A recursive fold visits all six list levels. Route: recursive function over next (control)"
features: [ts-recursive-type-routes, ts-recursive-type-route-lists]
---*/

// A recursive fold visits all six list levels. Route: recursive function over next. Node prints lists-recursive-fold:ok.
type L0 = {value:number;next:null};
type L1 = {value:number;next:L0};
type L2 = {value:number;next:L1};
type L3 = {value:number;next:L2};
type L4 = {value:number;next:L3};
type L5 = {value:number;next:L4};
type ListView = L0 | L1 | L2 | L3 | L4 | L5;
const head: ListView = {value:1,next:{value:2,next:{value:-0,next:{value:4,next:{value:NaN,next:{value:6,next:null}}}}}};
function fold(x:ListView|null):[number,number]{if(x===null)return[0,0];const r=fold(x.next);return[r[0]+(Number.isNaN(x.value)?0:x.value),r[1]+1];}
assert.compareArray(fold(head),[13,6]);
console.log("lists-recursive-fold:ok");

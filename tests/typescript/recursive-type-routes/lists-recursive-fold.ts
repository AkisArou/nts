/*---
description: "A recursive fold visits all six list levels. Route: recursive function over next"
features: [ts-recursive-type-routes, ts-recursive-type-route-lists]
---*/

// A recursive fold visits all six list levels. Route: recursive function over next. Node prints lists-recursive-fold:ok.
interface RList { value: number; next: RList | null }
type ListView = RList;
const head: ListView = {value:1,next:{value:2,next:{value:-0,next:{value:4,next:{value:NaN,next:{value:6,next:null}}}}}};
function fold(x:ListView|null):[number,number]{if(x===null)return[0,0];const r=fold(x.next);return[r[0]+(Number.isNaN(x.value)?0:x.value),r[1]+1];}
assert.compareArray(fold(head),[13,6]);
console.log("lists-recursive-fold:ok");

/*---
description: "A recursively typed generic class preserves two payload instantiations. Route: class-paired"
features: [ts-recursive-type-routes, ts-recursive-type-route-generics]
---*/

// A recursively typed generic class preserves two payload instantiations. Route: class-paired. Node prints generics-class-paired:ok.
class Chain<T>{value:T;next:Chain<T>|null;constructor(value:T,next:Chain<T>|null){this.value=value;this.next=next;}}type View<T>=Chain<T>;
const numbers:View<number>=new Chain<number>(0,new Chain<number>(-0,new Chain<number>(NaN,null)));const strings:View<string>=new Chain<string>('',new Chain<string>('b',new Chain<string>('c',null)));
function read<T>(head:View<T>):T[]{const out:T[]=[];let cur:View<T>|null=head;while(cur!==null){out.push(cur.value);cur=cur.next;}return out;}
assert.compareArray(read<number>(numbers),[0,-0,NaN]);assert.compareArray(read<string>(strings),['','b','c']);
console.log("generics-class-paired:ok");

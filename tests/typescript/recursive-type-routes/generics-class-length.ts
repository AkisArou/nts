/*---
description: "A generic recursive class retains its exact finite length. Route: class-length"
features: [ts-recursive-type-routes, ts-recursive-type-route-generics]
---*/

// A generic recursive class retains its exact finite length. Route: class-length. Node prints generics-class-length:ok.
class Chain<T>{value:T;next:Chain<T>|null;constructor(value:T,next:Chain<T>|null){this.value=value;this.next=next;}}type View<T>=Chain<T>;
const numbers:View<number>=new Chain<number>(0,new Chain<number>(-0,new Chain<number>(NaN,null)));const strings:View<string>=new Chain<string>('',new Chain<string>('b',new Chain<string>('c',null)));
function read<T>(head:View<T>):T[]{const out:T[]=[];let cur:View<T>|null=head;while(cur!==null){out.push(cur.value);cur=cur.next;}return out;}
assert.sameValue(read<number>(numbers).length,3);assert.sameValue(read<string>(strings).length,3);
console.log("generics-class-length:ok");

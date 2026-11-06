/*---
description: "Generic recursive class links retain a deep NaN. Route: class-nan"
features: [ts-recursive-type-routes, ts-recursive-type-route-generics]
---*/

// Generic recursive class links retain a deep NaN. Route: class-nan. Node prints generics-class-nan:ok.
class Chain<T>{value:T;next:Chain<T>|null;constructor(value:T,next:Chain<T>|null){this.value=value;this.next=next;}}type View<T>=Chain<T>;
const numbers:View<number>=new Chain<number>(0,new Chain<number>(-0,new Chain<number>(NaN,null)));const strings:View<string>=new Chain<string>('',new Chain<string>('b',new Chain<string>('c',null)));
function read<T>(head:View<T>):T[]{const out:T[]=[];let cur:View<T>|null=head;while(cur!==null){out.push(cur.value);cur=cur.next;}return out;}
assert.sameValue(read<number>(numbers)[2],NaN);
console.log("generics-class-nan:ok");

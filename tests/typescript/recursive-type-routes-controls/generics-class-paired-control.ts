/*---
description: "A recursively typed generic class preserves two payload instantiations. Route: class-paired (control)"
features: [ts-recursive-type-routes, ts-recursive-type-route-generics]
---*/

// A recursively typed generic class preserves two payload instantiations. Route: class-paired. Node prints generics-class-paired:ok.
class C0<T>{value:T;next:null=null;constructor(value:T){this.value=value;}}class C1<T>{value:T;next:C0<T>;constructor(value:T,next:C0<T>){this.value=value;this.next=next;}}class C2<T>{value:T;next:C1<T>;constructor(value:T,next:C1<T>){this.value=value;this.next=next;}}type View<T>=C0<T>|C1<T>|C2<T>;
const numbers:View<number>=new C2<number>(0,new C1<number>(-0,new C0<number>(NaN)));const strings:View<string>=new C2<string>('',new C1<string>('b',new C0<string>('c')));
function read<T>(head:View<T>):T[]{const out:T[]=[];let cur:View<T>|null=head;while(cur!==null){out.push(cur.value);cur=cur.next;}return out;}
assert.compareArray(read<number>(numbers),[0,-0,NaN]);assert.compareArray(read<string>(strings),['','b','c']);
console.log("generics-class-paired:ok");

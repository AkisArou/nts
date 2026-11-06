/*---
description: "F-bounded Ordered comparison sorts concrete versions. Route: fbound-sort"
features: [ts-recursive-type-routes, ts-recursive-type-route-generics]
---*/

// F-bounded Ordered comparison sorts concrete versions. Route: fbound-sort. Node prints generics-fbound-sort:ok.
interface Ordered<T extends Ordered<T>>{compare(other:T):number}class Version implements Ordered<Version>{value:number;constructor(value:number){this.value=value;}compare(other:Version):number{return this.value-other.value;}}
const values=[new Version(3),new Version(1),new Version(2)];
values.sort((a,b)=>a.compare(b));
assert.compareArray(values.map(x=>x.value),[1,2,3]);
console.log("generics-fbound-sort:ok");

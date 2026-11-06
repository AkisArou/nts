/*---
description: "F-bounded Ordered comparison retains ordered equality and differences. Route: fbound-compare (control)"
features: [ts-recursive-type-routes, ts-recursive-type-route-generics]
---*/

// F-bounded Ordered comparison retains ordered equality and differences. Route: fbound-compare. Node prints generics-fbound-compare:ok.
class Version{value:number;constructor(value:number){this.value=value;}compare(other:Version):number{return this.value-other.value;}}
const a=new Version(2),b=new Version(5);

assert.sameValue(a.compare(b),-3);assert.sameValue(b.compare(a),3);assert.sameValue(a.compare(a),0);
console.log("generics-fbound-compare:ok");

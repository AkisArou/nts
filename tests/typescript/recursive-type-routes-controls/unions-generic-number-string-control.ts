/*---
description: "Recursive ValueOrArray keeps separate numeric and string instantiations. Route: generic-number-string (control)"
features: [ts-recursive-type-routes, ts-recursive-type-route-unions]
---*/

// Recursive ValueOrArray keeps separate numeric and string instantiations. Route: generic-number-string. Node prints unions-generic-number-string:ok.
type A0<T>=T;type A1<T>=T|T[];type A2<T>=T|A1<T>[];type A3<T>=T|A2<T>[];type View<T>=A0<T>|A1<T>|A2<T>|A3<T>;
function flat<T>(root:View<T>):T[]{if(!Array.isArray(root))return [root];const out:T[]=[];for(const item of root)out.push(...flat<T>(item));return out;}
const numbers:View<number>=[0,[-0,[NaN]]];const strings:View<string>=['',['x',['y']]];
assert.compareArray(flat<number>(numbers),[0,-0,NaN]);assert.compareArray(flat<string>(strings),['','x','y']);
console.log("unions-generic-number-string:ok");

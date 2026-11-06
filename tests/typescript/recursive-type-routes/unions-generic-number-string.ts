/*---
description: "Recursive ValueOrArray keeps separate numeric and string instantiations. Route: generic-number-string"
features: [ts-recursive-type-routes, ts-recursive-type-route-unions]
---*/

// Recursive ValueOrArray keeps separate numeric and string instantiations. Route: generic-number-string. Node prints unions-generic-number-string:ok.
type ValueOrArray<T>=T|ValueOrArray<T>[];type View<T>=ValueOrArray<T>;
function flat<T>(root:View<T>):T[]{if(!Array.isArray(root))return [root];const out:T[]=[];for(const item of root)out.push(...flat<T>(item));return out;}
const numbers:View<number>=[0,[-0,[NaN]]];const strings:View<string>=['',['x',['y']]];
assert.compareArray(flat<number>(numbers),[0,-0,NaN]);assert.compareArray(flat<string>(strings),['','x','y']);
console.log("unions-generic-number-string:ok");

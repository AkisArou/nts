/*---
description: "Recursive ValueOrArray keeps separate bigint and boolean instantiations. Route: generic-bigint-boolean"
features: [ts-recursive-type-routes, ts-recursive-type-route-unions]
---*/

// Recursive ValueOrArray keeps separate bigint and boolean instantiations. Route: generic-bigint-boolean. Node prints unions-generic-bigint-boolean:ok.
type ValueOrArray<T>=T|ValueOrArray<T>[];type View<T>=ValueOrArray<T>;
function flat<T>(root:View<T>):T[]{if(!Array.isArray(root))return [root];const out:T[]=[];for(const item of root)out.push(...flat<T>(item));return out;}
const bigs:View<bigint>=[0n,[3n,[4n]]];const flags:View<boolean>=[false,[true,[false]]];
assert.compareArray(flat<bigint>(bigs),[0n,3n,4n]);assert.compareArray(flat<boolean>(flags),[false,true,false]);
console.log("unions-generic-bigint-boolean:ok");

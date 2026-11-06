/*---
description: "Recursive ValueOrArray keeps separate bigint and boolean instantiations. Route: generic-bigint-boolean (control)"
features: [ts-recursive-type-routes, ts-recursive-type-route-unions]
---*/

// Recursive ValueOrArray keeps separate bigint and boolean instantiations. Route: generic-bigint-boolean. Node prints unions-generic-bigint-boolean:ok.
type A0<T>=T;type A1<T>=T|T[];type A2<T>=T|A1<T>[];type A3<T>=T|A2<T>[];type View<T>=A0<T>|A1<T>|A2<T>|A3<T>;
function flat<T>(root:View<T>):T[]{if(!Array.isArray(root))return [root];const out:T[]=[];for(const item of root)out.push(...flat<T>(item));return out;}
const bigs:View<bigint>=[0n,[3n,[4n]]];const flags:View<boolean>=[false,[true,[false]]];
assert.compareArray(flat<bigint>(bigs),[0n,3n,4n]);assert.compareArray(flat<boolean>(flags),[false,true,false]);
console.log("unions-generic-bigint-boolean:ok");

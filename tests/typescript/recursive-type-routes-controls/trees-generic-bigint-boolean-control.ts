/*---
description: "One generic recursive walker preserves bigint and boolean instantiations. Route: generic-bigint-boolean (control)"
features: [ts-recursive-type-routes, ts-recursive-type-route-trees]
---*/

// One generic recursive walker preserves bigint and boolean instantiations. Route: generic-bigint-boolean; node prints trees-generic-bigint-boolean:ok.
type G0<T>={value:T;children:[]};type G1<T>={value:T;children:G0<T>[]};type G2<T>={value:T;children:(G0<T>|G1<T>)[]};type View<T>=G0<T>|G1<T>|G2<T>;
function flat<T>(root:View<T>):T[]{const out:T[]=[];function visit(n:View<T>):void{out.push(n.value);for(const child of n.children)visit(child);}visit(root);return out;}
const a:View<bigint>={value:0n,children:[{value:5n,children:[]}]};const z:View<boolean>={value:false,children:[{value:true,children:[]}]};
assert.compareArray(flat<bigint>(a),[0n,5n]);assert.compareArray(flat<boolean>(z),[false,true]);
console.log("trees-generic-bigint-boolean:ok");

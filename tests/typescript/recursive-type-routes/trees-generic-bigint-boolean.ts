/*---
description: "One generic recursive walker preserves bigint and boolean instantiations. Route: generic-bigint-boolean"
features: [ts-recursive-type-routes, ts-recursive-type-route-trees]
---*/

// One generic recursive walker preserves bigint and boolean instantiations. Route: generic-bigint-boolean; node prints trees-generic-bigint-boolean:ok.
interface Tree<T>{value:T;children:Tree<T>[]};type View<T>=Tree<T>;
function flat<T>(root:View<T>):T[]{const out:T[]=[];function visit(n:View<T>):void{out.push(n.value);for(const child of n.children)visit(child);}visit(root);return out;}
const a:View<bigint>={value:0n,children:[{value:5n,children:[]}]};const z:View<boolean>={value:false,children:[{value:true,children:[]}]};
assert.compareArray(flat<bigint>(a),[0n,5n]);assert.compareArray(flat<boolean>(z),[false,true]);
console.log("trees-generic-bigint-boolean:ok");

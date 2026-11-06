/*---
description: "Generic recursive tree leaf order is stable at two instantiations. Route: tree-leaf-order"
features: [ts-recursive-type-routes, ts-recursive-type-route-generics]
---*/

// Generic recursive tree leaf order is stable at two instantiations. Route: tree-leaf-order. Node prints generics-tree-leaf-order:ok.
interface Tree<T>{value:T;children:Tree<T>[]};type View<T>=Tree<T>;
const numbers:View<number>={value:0,children:[{value:-0,children:[{value:NaN,children:[]}]}]};const strings:View<string>={value:'',children:[{value:'x',children:[{value:'y',children:[]}]}]};
function leaves<T>(n:View<T>):T[]{if(n.children.length===0)return [n.value];const out:T[]=[];for(const child of n.children)out.push(...leaves(child));return out;}
assert.compareArray(leaves<number>(numbers),[NaN]);assert.compareArray(leaves<string>(strings),['y']);
console.log("generics-tree-leaf-order:ok");

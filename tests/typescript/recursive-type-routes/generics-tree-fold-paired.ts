/*---
description: "One recursive generic fold retains number and string measurements. Route: tree-fold-paired"
features: [ts-recursive-type-routes, ts-recursive-type-route-generics]
---*/

// One recursive generic fold retains number and string measurements. Route: tree-fold-paired. Node prints generics-tree-fold-paired:ok.
interface Tree<T>{value:T;children:Tree<T>[]};type View<T>=Tree<T>;
const numbers:View<number>={value:0,children:[{value:-0,children:[{value:NaN,children:[]}]}]};const texts:View<string>={value:'',children:[{value:'x',children:[{value:'y',children:[]}]}]};
function fold<T>(n:View<T>,measure:(value:T)=>number):number{let count=measure(n.value);for(const child of n.children)count+=fold(child,measure);return count;}
assert.sameValue(fold<number>(numbers,n=>Number.isNaN(n)?3:1),5);assert.sameValue(fold<string>(texts,s=>s.length),2);
console.log("generics-tree-fold-paired:ok");

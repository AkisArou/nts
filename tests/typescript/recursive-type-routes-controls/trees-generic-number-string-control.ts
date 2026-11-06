/*---
description: "One generic recursive tree walker preserves number and string instantiations. Route: generic-number-string (control)"
features: [ts-recursive-type-routes, ts-recursive-type-route-trees]
---*/

// One generic recursive tree walker preserves number and string instantiations. Route: generic-number-string; node prints trees-generic-number-string:ok.
type G0<T>={value:T;children:[]};type G1<T>={value:T;children:G0<T>[]};type G2<T>={value:T;children:(G0<T>|G1<T>)[]};type View<T>=G0<T>|G1<T>|G2<T>;
function flat<T>(root:View<T>):T[]{const out:T[]=[];function visit(n:View<T>):void{out.push(n.value);for(const child of n.children)visit(child);}visit(root);return out;}
const a:View<number>={value:-0,children:[{value:NaN,children:[]}]};const z:View<string>={value:'',children:[{value:'x',children:[]}]};
assert.compareArray(flat<number>(a),[-0,NaN]);assert.compareArray(flat<string>(z),['','x']);
console.log("trees-generic-number-string:ok");

/*---
description: "A polymorphic this array retains subclass child order. Route: this-typed-order (control)"
features: [ts-recursive-type-routes, ts-recursive-type-route-generics]
---*/

// A polymorphic this array retains subclass child order. Route: this-typed-order. Node prints generics-this-typed-order:ok.
class Leaf{label:string;constructor(label:string){this.label=label;}}class Labeled{label:string;children:Leaf[]=[];constructor(label:string){this.label=label;}}
const root=new Labeled('root');root.children.push(new Leaf('a'),new Leaf('b'));

assert.compareArray(root.children.map(x=>x.label),['a','b']);
console.log("generics-this-typed-order:ok");

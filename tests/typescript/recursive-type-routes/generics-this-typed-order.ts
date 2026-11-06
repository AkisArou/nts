/*---
description: "A polymorphic this array retains subclass child order. Route: this-typed-order"
features: [ts-recursive-type-routes, ts-recursive-type-route-generics]
---*/

// A polymorphic this array retains subclass child order. Route: this-typed-order. Node prints generics-this-typed-order:ok.
class TreeNode{children:this[]=[];}class Labeled extends TreeNode{label:string;constructor(label:string){super();this.label=label;}}
const root=new Labeled('root');root.children.push(new Labeled('a'),new Labeled('b'));

assert.compareArray(root.children.map(x=>x.label),['a','b']);
console.log("generics-this-typed-order:ok");

/*---
description: "A subclass reads its concrete label through a polymorphic this child field. Route: this-typed-child (control)"
features: [ts-recursive-type-routes, ts-recursive-type-route-generics]
---*/

// A subclass reads its concrete label through a polymorphic this child field. Route: this-typed-child. Node prints generics-this-typed-child:ok.
class Leaf{label:string;constructor(label:string){this.label=label;}}class Labeled{label:string;children:Leaf[]=[];constructor(label:string){this.label=label;}}
const root=new Labeled('root');root.children.push(new Leaf('leaf'));

assert.sameValue(root.children[0].label,'leaf');
console.log("generics-this-typed-child:ok");

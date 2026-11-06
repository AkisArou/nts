/*---
description: "A subclass reads its concrete label through a polymorphic this child field. Route: this-typed-child"
features: [ts-recursive-type-routes, ts-recursive-type-route-generics]
---*/

// A subclass reads its concrete label through a polymorphic this child field. Route: this-typed-child. Node prints generics-this-typed-child:ok.
class TreeNode{children:this[]=[];}class Labeled extends TreeNode{label:string;constructor(label:string){super();this.label=label;}}
const root=new Labeled('root');root.children.push(new Labeled('leaf'));

assert.sameValue(root.children[0].label,'leaf');
console.log("generics-this-typed-child:ok");

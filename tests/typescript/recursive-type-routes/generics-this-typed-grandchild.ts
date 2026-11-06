/*---
description: "A polymorphic this child array retains subclass fields across two levels. Route: this-typed-grandchild"
features: [ts-recursive-type-routes, ts-recursive-type-route-generics]
---*/

// A polymorphic this child array retains subclass fields across two levels. Route: this-typed-grandchild. Node prints generics-this-typed-grandchild:ok.
class TreeNode{children:this[]=[];}class Labeled extends TreeNode{label:string;constructor(label:string){super();this.label=label;}}
const root=new Labeled('root');const mid=new Labeled('middle'),leaf=new Labeled('leaf');mid.children.push(leaf);root.children.push(mid);assert.sameValue(root.children[0].children[0].label,'leaf');
console.log("generics-this-typed-grandchild:ok");

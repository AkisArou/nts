/*---
description: "A polymorphic this child array retains subclass fields across two levels. Route: this-typed-grandchild (control)"
features: [ts-recursive-type-routes, ts-recursive-type-route-generics]
---*/

// A polymorphic this child array retains subclass fields across two levels. Route: this-typed-grandchild. Node prints generics-this-typed-grandchild:ok.
class Leaf{label:string;children:[]=[];constructor(label:string){this.label=label;}}class Middle{label:string;children:Leaf[]=[];constructor(label:string){this.label=label;}}class Labeled{label:string;children:Middle[]=[];constructor(label:string){this.label=label;}}
const root=new Labeled('root');const mid=new Middle('middle'),leaf=new Leaf('leaf');mid.children.push(leaf);root.children.push(mid);assert.sameValue(root.children[0].children[0].label,'leaf');
console.log("generics-this-typed-grandchild:ok");

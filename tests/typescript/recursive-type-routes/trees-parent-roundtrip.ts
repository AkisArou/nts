/*---
description: "A recursive child returns to the root through parent pointers. Route: typed recursive parent and kids"
features: [ts-recursive-type-routes, ts-recursive-type-route-trees]
---*/

// A recursive child returns to the root through parent pointers. Route: typed recursive parent and kids. Node prints trees-parent-roundtrip:ok.
interface Parented{id:string;parent:Parented|null;kids:Parented[]};
const root:Parented={id:'r',parent:null,kids:[]};const middle:Parented={id:'m',parent:root,kids:[]};const leaf:Parented={id:'l',parent:middle,kids:[]};root.kids.push(middle);middle.kids.push(leaf);assert.sameValue(leaf.parent?.parent===root,true);assert.sameValue(root.kids[0].kids[0]===leaf,true);
console.log("trees-parent-roundtrip:ok");

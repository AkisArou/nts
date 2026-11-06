/*---
description: "A write through a recursive parent alias remains visible to its child path. Route: typed recursive parent and kids"
features: [ts-recursive-type-routes, ts-recursive-type-route-trees]
---*/

// A write through a recursive parent alias remains visible to its child path. Route: typed recursive parent and kids. Node prints trees-parent-write-through:ok.
interface Parented{id:string;parent:Parented|null;kids:Parented[]};
const root:Parented={id:'r',parent:null,kids:[]};const middle:Parented={id:'m',parent:root,kids:[]};const leaf:Parented={id:'l',parent:middle,kids:[]};root.kids.push(middle);middle.kids.push(leaf);if(leaf.parent===null)throw new Error('missing');leaf.parent.id='updated';assert.sameValue(root.kids[0].id,'updated');assert.sameValue(leaf.parent.id,'updated');
console.log("trees-parent-write-through:ok");

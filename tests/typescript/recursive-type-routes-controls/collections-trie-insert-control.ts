/*---
description: "A recursive Trie inserts and reads an additional child at depth two. Route: trie-insert (control)"
features: [ts-recursive-type-routes, ts-recursive-type-route-collections]
---*/

// A recursive Trie inserts and reads an additional child at depth two. Route: trie-insert. Node prints collections-trie-insert:ok.
type T0={end:boolean;next:Map<string,never>};type T1={end:boolean;next:Map<string,T0>};type T2={end:boolean;next:Map<string,T1>};
const leaf:T0={end:true,next:new Map<string,never>()};const middle:T1={end:false,next:new Map([['b',leaf]])};const root:T2={end:false,next:new Map([['a',middle]])};middle.next.set('c',{end:true,next:new Map<string,never>()});assert.sameValue(root.next.get('a')?.next.get('c')?.end,true);
console.log("collections-trie-insert:ok");

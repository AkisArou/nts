/*---
description: "A recursive Trie inserts and reads an additional child at depth two. Route: trie-insert"
features: [ts-recursive-type-routes, ts-recursive-type-route-collections]
---*/

// A recursive Trie inserts and reads an additional child at depth two. Route: trie-insert. Node prints collections-trie-insert:ok.
interface Trie{end:boolean;next:Map<string,Trie>};
const leaf:Trie={end:true,next:new Map()};const middle:Trie={end:false,next:new Map([['b',leaf]])};const root:Trie={end:false,next:new Map([['a',middle]])};middle.next.set('c',{end:true,next:new Map()});assert.sameValue(root.next.get('a')?.next.get('c')?.end,true);
console.log("collections-trie-insert:ok");

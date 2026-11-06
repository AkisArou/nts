/*---
description: "Recursive Trie terminal state survives multiple typed layers. Route: trie-terminal"
features: [ts-recursive-type-routes, ts-recursive-type-route-collections]
---*/

// Recursive Trie terminal state survives multiple typed layers. Route: trie-terminal. Node prints collections-trie-terminal:ok.
interface Trie{end:boolean;next:Map<string,Trie>};type View=Trie;
const leaf:Trie={end:true,next:new Map()};const middle:Trie={end:false,next:new Map([["b",leaf]])};const root:View={end:false,next:new Map([["a",middle]])};
const first=root.next.get('a');if(first===undefined)throw new Error('missing');const second=first.next.get('b');
assert.sameValue(second?.end,true);
console.log("collections-trie-terminal:ok");

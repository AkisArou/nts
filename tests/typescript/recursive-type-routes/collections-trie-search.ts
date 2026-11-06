/*---
description: "A recursive Trie follows nested Map edges to a terminal node. Route: trie-search"
features: [ts-recursive-type-routes, ts-recursive-type-route-collections]
---*/

// A recursive Trie follows nested Map edges to a terminal node. Route: trie-search. Node prints collections-trie-search:ok.
interface Trie{end:boolean;next:Map<string,Trie>};type View=Trie;
const leaf:Trie={end:true,next:new Map()};const middle:Trie={end:false,next:new Map([["b",leaf]])};const root:View={end:false,next:new Map([["a",middle]])};
function has(node:View,word:string):boolean{let cur:View|undefined=node;for(const letter of word){if(cur===undefined)return false;cur=cur.next.get(letter);}return cur?.end===true;}
assert.sameValue(has(root,'ab'),true);assert.sameValue(has(root,'a'),false);assert.sameValue(has(root,'ac'),false);
console.log("collections-trie-search:ok");

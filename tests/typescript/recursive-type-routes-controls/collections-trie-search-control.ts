/*---
description: "A recursive Trie follows nested Map edges to a terminal node. Route: trie-search (control)"
features: [ts-recursive-type-routes, ts-recursive-type-route-collections]
---*/

// A recursive Trie follows nested Map edges to a terminal node. Route: trie-search. Node prints collections-trie-search:ok.
type T0={end:boolean;next:Map<string,never>};type T1={end:boolean;next:Map<string,T0>};type T2={end:boolean;next:Map<string,T1>};type View=T0|T1|T2;
const leaf:T0={end:true,next:new Map<string,never>()};const middle:T1={end:false,next:new Map([["b",leaf]])};const root:View={end:false,next:new Map([["a",middle]])};
function has(node:View,word:string):boolean{let cur:View|undefined=node;for(const letter of word){if(cur===undefined)return false;cur=cur.next.get(letter);}return cur?.end===true;}
assert.sameValue(has(root,'ab'),true);assert.sameValue(has(root,'a'),false);assert.sameValue(has(root,'ac'),false);
console.log("collections-trie-search:ok");

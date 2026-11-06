/*---
description: "Recursive Trie terminal state survives multiple typed layers. Route: trie-terminal (control)"
features: [ts-recursive-type-routes, ts-recursive-type-route-collections]
---*/

// Recursive Trie terminal state survives multiple typed layers. Route: trie-terminal. Node prints collections-trie-terminal:ok.
type T0={end:boolean;next:Map<string,never>};type T1={end:boolean;next:Map<string,T0>};type T2={end:boolean;next:Map<string,T1>};type View=T0|T1|T2;
const leaf:T0={end:true,next:new Map<string,never>()};const middle:T1={end:false,next:new Map([["b",leaf]])};const root:View={end:false,next:new Map([["a",middle]])};
const first=root.next.get('a');if(first===undefined)throw new Error('missing');const second=first.next.get('b');
assert.sameValue(second?.end,true);
console.log("collections-trie-terminal:ok");

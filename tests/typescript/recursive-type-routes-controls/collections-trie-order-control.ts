/*---
description: "Recursive Trie Map edges retain the nested path. Route: trie-order (control)"
features: [ts-recursive-type-routes, ts-recursive-type-route-collections]
---*/

// Recursive Trie Map edges retain the nested path. Route: trie-order. Node prints collections-trie-order:ok.
type T0={end:boolean;next:Map<string,never>};type T1={end:boolean;next:Map<string,T0>};type T2={end:boolean;next:Map<string,T1>};type View=T0|T1|T2;
const leaf:T0={end:true,next:new Map<string,never>()};const middle:T1={end:false,next:new Map([["b",leaf]])};const root:View={end:false,next:new Map([["a",middle]])};
const log:string[]=[];function walk(t:View):void{for(const [key,child]of t.next){log.push(key);walk(child);}}walk(root);
assert.compareArray(log,["a","b"]);
console.log("collections-trie-order:ok");

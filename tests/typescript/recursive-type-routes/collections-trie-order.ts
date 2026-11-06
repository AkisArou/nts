/*---
description: "Recursive Trie Map edges retain the nested path. Route: trie-order"
features: [ts-recursive-type-routes, ts-recursive-type-route-collections]
---*/

// Recursive Trie Map edges retain the nested path. Route: trie-order. Node prints collections-trie-order:ok.
interface Trie{end:boolean;next:Map<string,Trie>};type View=Trie;
const leaf:Trie={end:true,next:new Map()};const middle:Trie={end:false,next:new Map([["b",leaf]])};const root:View={end:false,next:new Map([["a",middle]])};
const log:string[]=[];function walk(t:View):void{for(const [key,child]of t.next){log.push(key);walk(child);}}walk(root);
assert.compareArray(log,["a","b"]);
console.log("collections-trie-order:ok");

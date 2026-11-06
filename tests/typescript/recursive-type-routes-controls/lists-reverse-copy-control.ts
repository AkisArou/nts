/*---
description: "Reversing a recursive list by copy leaves the source unchanged. Route: fresh list nodes (control)"
features: [ts-recursive-type-routes, ts-recursive-type-route-lists]
---*/

// Reversing a recursive list by copy leaves the source unchanged. Route: fresh list nodes. Node prints lists-reverse-copy:ok.
interface Cell{value:number;next:number};
const source:Cell[]=[{value:1,next:1},{value:2,next:2},{value:3,next:-1}];const copied:Cell[]=[];let first=-1;for(let p=0;p!==-1;p=source[p].next){copied.push({value:source[p].value,next:first});first=copied.length-1;}
const values:number[]=[];for(let p=first;p!==-1;p=copied[p].next)values.push(copied[p].value);
assert.compareArray(values,[3,2,1]);assert.sameValue(source[1].value,2);assert.sameValue(copied!==source,true);
console.log("lists-reverse-copy:ok");

/*---
description: "Nested recursive JSON-like values keep an empty array distinct from null. Route: json-empty-array"
features: [ts-recursive-type-routes, ts-recursive-type-route-unions]
---*/

// Nested recursive JSON-like values keep an empty array distinct from null. Route: json-empty-array. Node prints unions-json-empty-array:ok.
type Json=null|boolean|number|string|Json[]|{[key:string]:Json};type View=Json;
function show(v:View):string{if(v===null)return "null";if(typeof v==="number")return Object.is(v,-0)?"-0":Number.isNaN(v)?"NaN":String(v);if(typeof v==="string")return "s:"+v;if(typeof v==="boolean")return "b:"+v;if(Array.isArray(v))return "["+v.map(show).join(",")+"]";const parts:string[]=[];for(const k in v)parts.push(k+":"+show(v[k]));return "{"+parts.join(",")+"}";}
const value:View={a:[{b:[]}]};
assert.sameValue(show(value),"{a:[{b:[]}]}");
console.log("unions-json-empty-array:ok");

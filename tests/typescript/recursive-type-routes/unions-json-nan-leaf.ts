/*---
description: "Nested recursive JSON-like values preserve NaN. Route: json-nan-leaf"
features: [ts-recursive-type-routes, ts-recursive-type-route-unions]
---*/

// Nested recursive JSON-like values preserve NaN. Route: json-nan-leaf. Node prints unions-json-nan-leaf:ok.
type Json=null|boolean|number|string|Json[]|{[key:string]:Json};type View=Json;
function show(v:View):string{if(v===null)return "null";if(typeof v==="number")return Object.is(v,-0)?"-0":Number.isNaN(v)?"NaN":String(v);if(typeof v==="string")return "s:"+v;if(typeof v==="boolean")return "b:"+v;if(Array.isArray(v))return "["+v.map(show).join(",")+"]";const parts:string[]=[];for(const k in v)parts.push(k+":"+show(v[k]));return "{"+parts.join(",")+"}";}
const value:View={a:[{b:NaN}]};
assert.sameValue(show(value),"{a:[{b:NaN}]}");
console.log("unions-json-nan-leaf:ok");

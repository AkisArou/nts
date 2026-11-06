/*---
description: "Recursive object walking preserves integer and insertion key order. Route: json-order-keys"
features: [ts-recursive-type-routes, ts-recursive-type-route-unions]
---*/

// Recursive object walking preserves integer and insertion key order. Route: json-order-keys. Node prints unions-json-order-keys:ok.
type Json=null|boolean|number|string|Json[]|{[key:string]:Json};type View=Json;
function show(v:View):string{if(v===null)return "null";if(typeof v==="number")return Object.is(v,-0)?"-0":Number.isNaN(v)?"NaN":String(v);if(typeof v==="string")return "s:"+v;if(typeof v==="boolean")return "b:"+v;if(Array.isArray(v))return "["+v.map(show).join(",")+"]";const parts:string[]=[];for(const k in v)parts.push(k+":"+show(v[k]));return "{"+parts.join(",")+"}";}
const value:View={a:[{'2':2,b:3,'1':1,c:4}]};
assert.sameValue(show(value),"{a:[{1:1,2:2,b:3,c:4}]}");
console.log("unions-json-order-keys:ok");

/*---
description: "Nested recursive JSON-like values keep an empty object distinct from null. Route: json-empty-object (control)"
features: [ts-recursive-type-routes, ts-recursive-type-route-unions]
---*/

// Nested recursive JSON-like values keep an empty object distinct from null. Route: json-empty-object. Node prints unions-json-empty-object:ok.
type J0=null|boolean|number|string|[]|{[key:string]:never};type J1=J0|J0[]|{[k:string]:J0};type J2=J0|J1[]|{[k:string]:J1};type J3=J0|J2[]|{[k:string]:J2};type View=J0|J1|J2|J3;
function show(v:View):string{if(v===null)return "null";if(typeof v==="number")return Object.is(v,-0)?"-0":Number.isNaN(v)?"NaN":String(v);if(typeof v==="string")return "s:"+v;if(typeof v==="boolean")return "b:"+v;if(Array.isArray(v))return "["+v.map(show).join(",")+"]";const parts:string[]=[];for(const k in v)parts.push(k+":"+show(v[k]));return "{"+parts.join(",")+"}";}
const value:View={a:[{b:{}}]};
assert.sameValue(show(value),"{a:[{b:{}}]}");
console.log("unions-json-empty-object:ok");

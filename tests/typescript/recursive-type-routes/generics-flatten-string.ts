/*---
description: "Recursive conditional Flatten resolves a deeply nested string array type. Route: flatten-string"
features: [ts-recursive-type-routes, ts-recursive-type-route-generics]
---*/

// Recursive conditional Flatten resolves a deeply nested string array type. Route: flatten-string. Node prints generics-flatten-string:ok.
type Flatten<T>=T extends (infer U)[]?Flatten<U>:T;type View=Flatten<string[][][]>;
const data:View='';

assert.sameValue(data,'');
console.log("generics-flatten-string:ok");

/*---
description: "Recursive conditional Flatten resolves a deeply nested number array type. Route: flatten-number"
features: [ts-recursive-type-routes, ts-recursive-type-route-generics]
---*/

// Recursive conditional Flatten resolves a deeply nested number array type. Route: flatten-number. Node prints generics-flatten-number:ok.
type Flatten<T>=T extends (infer U)[]?Flatten<U>:T;type View=Flatten<number[][][]>;
const data:View=-0;

assert.sameValue(data,-0);
console.log("generics-flatten-number:ok");

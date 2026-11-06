/*---
description: "DeepReadonly recursively preserves signed zero inside nested array fields. Route: readonly-nested-array (control)"
features: [ts-recursive-type-routes, ts-recursive-type-route-generics]
---*/

// DeepReadonly recursively preserves signed zero inside nested array fields. Route: readonly-nested-array. Node prints generics-readonly-nested-array:ok.
type View={readonly items:readonly {readonly child:{readonly value:number}}[]};
const data:View={items:[{child:{value:-0}}]};assert.sameValue(data.items[0].child.value,-0);
console.log("generics-readonly-nested-array:ok");
